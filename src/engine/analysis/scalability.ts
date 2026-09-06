import type { ArchitectureGraph, Component, EvidenceLevel } from "../graph/types";
import { indexGraph, GraphIndex } from "../graph/queries";
import type { CapacityPoint, Finding, ScalabilityReport, ScalabilityTier, Severity } from "./types";

/**
 * Scalability attack: a capacity model evaluated at 1x, 2x, 5x, 10x, 50x.
 *
 * Per component the binding constraint is computed from the scaling profile
 * and the traffic share derived from the declared flows. Data-store
 * connection maths uses the dependents' instance counts at that tier, which
 * is what lets the engine say "connection exhaustion happens before CPU".
 * All numbers are ESTIMATES unless the profile came from measurements.
 */

const MULTIPLIERS = [1, 2, 5, 10, 50];

const DEFAULT_RPS_PER_INSTANCE: Partial<Record<Component["type"], number>> = {
  service: 100, worker: 20, serverless_function: 1000, web_frontend: 500, api_gateway: 5000, load_balancer: 20000, llm_gateway: 500,
};

export function analyzeScalability(graph: ArchitectureGraph): { findings: Finding[]; report: ScalabilityReport } {
  const idx = indexGraph(graph);
  const assumptions: string[] = [];
  const baseline = graph.traffic?.baselineRps ?? assumedBaseline(graph, assumptions);
  const baselineEvidence: EvidenceLevel = graph.traffic ? graph.traffic.evidence : "assumption";
  const share = trafficShare(idx);

  const tiers: ScalabilityTier[] = MULTIPLIERS.map((m) => evaluateTier(idx, baseline * m, m, share, assumptions));
  const breakOrder = computeBreakOrder(tiers);
  const stateful = graph.components.filter((c) => c.stateful).map((c) => c.id);
  const findings = deriveFindings(idx, tiers, breakOrder, baseline);
  const narrative = tiers.map((t) => {
    if (!t.saturated.length) return `${t.multiplier}x (${Math.round(t.demandRps)} rps): all modelled components within capacity.`;
    const first = t.firstFailure!;
    return `${t.multiplier}x (${Math.round(t.demandRps)} rps): ${first.name} saturates first - ${first.mechanism}${t.saturated.length > 1 ? ` Also saturated: ${t.saturated.slice(1).map((s) => s.name).join(", ")}.` : ""}`;
  });

  return {
    findings,
    report: { baselineRps: baseline, baselineEvidence, tiers, breakOrder, statefulComponentIds: stateful, narrative, assumptions: dedupe(assumptions) },
  };
}

function assumedBaseline(graph: ArchitectureGraph, assumptions: string[]): number {
  const mau = graph.traffic?.monthlyActiveUsers;
  const rps = mau ? Math.max(5, Math.round((mau * 40) / (30 * 8 * 3600))) : 50;
  assumptions.push(`No traffic profile supplied; baseline assumed at ${rps} rps${mau ? ` (from ${mau} monthly users, 40 requests/user/day over an 8h day)` : ""}.`);
  return rps;
}

/** Fraction of total traffic reaching each component, from flow membership weighted by trafficShare. */
function trafficShare(idx: GraphIndex): Map<string, number> {
  const share = new Map<string, number>();
  const flows = idx.graph.flows;
  const totalShare = flows.reduce((a, f) => a + (f.trafficShare ?? 1 / flows.length), 0) || 1;
  for (const f of flows) {
    const s = (f.trafficShare ?? 1 / flows.length) / totalShare;
    const seen = new Set<string>();
    for (const st of f.steps) {
      if (seen.has(st.componentId)) continue;
      seen.add(st.componentId);
      share.set(st.componentId, (share.get(st.componentId) ?? 0) + s);
    }
  }
  // Components not in any flow but with runtime dependents get their dependents' share.
  for (const c of idx.graph.components) {
    if (share.has(c.id)) continue;
    const dependents = idx.dependents(c.id);
    if (!dependents.length) continue;
    share.set(c.id, Math.min(1, dependents.reduce((a, e) => a + (share.get(e.source) ?? 0), 0)));
  }
  return share;
}

function instancesAt(c: Component, demandRps: number, assumptions: string[]): { instances: number; capped: boolean; rpsPer: number } {
  const rpsPer = c.scaling.rpsPerInstance ?? DEFAULT_RPS_PER_INSTANCE[c.type] ?? 100;
  if (!c.scaling.rpsPerInstance && DEFAULT_RPS_PER_INSTANCE[c.type]) assumptions.push(`${c.name}: per-instance throughput assumed at ${rpsPer} rps.`);
  const needed = Math.max(1, Math.ceil(demandRps / rpsPer));
  const min = c.scaling.minInstances ?? c.scaling.currentInstances ?? c.redundancy.replicas ?? 1;
  switch (c.scaling.model) {
    case "horizontal_auto": {
      const max = c.scaling.maxInstances ?? Number.POSITIVE_INFINITY;
      return { instances: Math.min(max, Math.max(min, needed)), capped: needed > max, rpsPer };
    }
    case "serverless":
    case "managed":
      return { instances: Math.max(min, needed), capped: false, rpsPer };
    default: {
      const fixed = c.scaling.currentInstances ?? c.redundancy.replicas ?? 1;
      return { instances: fixed, capped: needed > fixed, rpsPer };
    }
  }
}

function evaluateTier(idx: GraphIndex, demandRps: number, multiplier: number, share: Map<string, number>, assumptions: string[]): ScalabilityTier {
  const g = idx.graph;
  const points: CapacityPoint[] = [];
  const instanceCache = new Map<string, number>();
  const readRatio = g.traffic?.readRatio ?? 0.8;

  for (const c of g.components) {
    const s = share.get(c.id) ?? 0;
    const demand = demandRps * s;
    const ev: EvidenceLevel = c.evidence === "fact" && (c.scaling.rpsPerInstance || c.scaling.maxConnections || c.scaling.maxReadOps || c.scaling.requestsPerMinuteLimit) ? "inference" : "assumption";

    if (["service", "web_frontend", "api_gateway", "llm_gateway", "serverless_function"].includes(c.type) && c.scaling.model !== "none") {
      const { instances, capped, rpsPer } = instancesAt(c, demand, assumptions);
      instanceCache.set(c.id, instances);
      const capacity = instances * rpsPer;
      points.push(point(c, "compute throughput", demand, capacity, "rps", ev,
        capped
          ? `needs ${Math.ceil(demand / rpsPer)} instances at ${rpsPer} rps each but is capped at ${instances} (${c.scaling.model === "horizontal_auto" ? "maxInstances" : "fixed replica count"}).`
          : `${instances} instance(s) x ${rpsPer} rps serve ${Math.round(demand)} rps.`));
    }

    if (c.type === "worker") {
      const jobsPer = c.scaling.jobsPerSecondPerInstance ?? 5;
      if (!c.scaling.jobsPerSecondPerInstance) assumptions.push(`${c.name}: assumed ${jobsPer} jobs/s per instance.`);
      const instances = c.scaling.model === "horizontal_auto" ? Math.min(c.scaling.maxInstances ?? 1e9, Math.max(c.scaling.minInstances ?? 1, Math.ceil(demand / jobsPer))) : (c.scaling.currentInstances ?? c.redundancy.replicas ?? 1);
      instanceCache.set(c.id, instances);
      const capacity = instances * jobsPer;
      points.push(point(c, "job throughput", demand, capacity, "jobs/s", ev,
        demand > capacity
          ? `${instances} fixed instance(s) x ${jobsPer} jobs/s cannot keep up with ${demand.toFixed(1)} jobs/s; the queue backlog grows without bound (${(demand - capacity).toFixed(1)} jobs/s accumulate).`
          : `${instances} instance(s) x ${jobsPer} jobs/s absorb ${demand.toFixed(1)} jobs/s.`));
    }
  }

  for (const c of g.components) {
    const s = share.get(c.id) ?? 0;
    const demand = demandRps * s;
    const ev: EvidenceLevel = c.scaling.maxConnections || c.scaling.maxReadOps || c.scaling.maxWriteOps ? "inference" : "assumption";

    if (c.type === "relational_db" || c.type === "document_db") {
      // Connection maths: sum of dependents' instances x connections per instance.
      const conns = idx.dependents(c.id).map((e) => {
        const src = idx.component(e.source);
        const inst = instanceCache.get(src.id) ?? src.scaling.currentInstances ?? src.redundancy.replicas ?? 1;
        const per = e.connectionsPerInstance ?? 10;
        if (!e.connectionsPerInstance) assumptions.push(`${src.name} -> ${c.name}: assumed pool of 10 connections per instance.`);
        return { name: src.name, inst, per, total: inst * per };
      });
      const totalConns = conns.reduce((a, x) => a + x.total, 0);
      const maxConns = c.scaling.connectionPooler ? (c.scaling.maxConnections ?? 100) * 10 : (c.scaling.maxConnections ?? 100);
      if (!c.scaling.maxConnections) assumptions.push(`${c.name}: max_connections assumed 100.`);
      const breakdown = conns.map((x) => `${x.name} ${x.inst}x${x.per}`).join(" + ");
      points.push(point(c, "connections", totalConns, maxConns, "connections", ev,
        totalConns > maxConns
          ? `${breakdown} = ${totalConns} connections exceeds max_connections ${maxConns}${c.scaling.connectionPooler ? " (even with pooling)" : " and there is no connection pooler"}; new connections are refused and requests fail before CPU is a factor.`
          : `${breakdown} = ${totalConns} of ${maxConns} connections.`));
      const writes = demand * (1 - readRatio);
      const reads = demand * readRatio;
      const maxW = c.scaling.maxWriteOps ?? 2000;
      const cacheInFront = idx.dependents(c.id).some((e) => idx.dependencies(e.source).some((d) => idx.component(d.target).type === "cache"));
      const effectiveReads = cacheInFront ? reads * 0.3 : reads;
      if (cacheInFront) assumptions.push(`${c.name}: cache in front assumed to absorb 70% of reads.`);
      const maxR = (c.scaling.maxReadOps ?? 10_000) * (1 + (c.scaling.readReplicas ?? 0));
      points.push(point(c, "write throughput (single primary)", writes, maxW, "writes/s", ev,
        writes > maxW ? `${Math.round(writes)} writes/s exceeds the single primary's ~${maxW} writes/s; there is no horizontal write scaling for a relational primary.` : `${Math.round(writes)} of ~${maxW} writes/s on the primary.`));
      points.push(point(c, "read throughput", effectiveReads, maxR, "reads/s", ev,
        effectiveReads > maxR ? `${Math.round(effectiveReads)} reads/s exceeds ${maxR} reads/s with ${c.scaling.readReplicas ?? 0} read replica(s).` : `${Math.round(effectiveReads)} of ${maxR} reads/s (${c.scaling.readReplicas ?? 0} replicas).`));
    }

    if (c.type === "cache") {
      const maxOps = (c.scaling.maxReadOps ?? 50_000) * (c.scaling.clusterMode ? 3 : 1);
      points.push(point(c, "operations", demand * 2, maxOps, "ops/s", ev,
        demand * 2 > maxOps ? `${Math.round(demand * 2)} ops/s exceeds a ${c.scaling.clusterMode ? "clustered" : "single-node"} cache at ~${maxOps} ops/s.` : `${Math.round(demand * 2)} of ~${maxOps} ops/s (2 ops per request assumed).`));
    }

    if (c.type === "vector_db" || c.type === "search") {
      const max = (c.scaling.maxReadOps ?? 100) * Math.max(1, c.redundancy.replicas);
      points.push(point(c, "query throughput", demand, max, "qps", ev,
        demand > max ? `${Math.round(demand)} qps exceeds ${max} qps on ${c.redundancy.replicas} node(s); p95 latency climbs and the API's sync calls start timing out.` : `${Math.round(demand)} of ${max} qps.`));
    }

    if (c.type === "queue" || c.type === "stream") {
      const max = c.scaling.maxMessagesPerSecond ?? 1000;
      points.push(point(c, "message throughput", demand, max, "msg/s", ev,
        demand > max ? `${Math.round(demand)} msg/s exceeds the tier limit of ${max} msg/s; producers are throttled.` : `${Math.round(demand)} of ${max} msg/s.`));
    }

    if (c.type === "llm_provider" || c.type === "embedding_service" || c.type === "ml_inference") {
      const aiDemand = g.traffic?.aiRequestsPerSecond !== undefined ? g.traffic.aiRequestsPerSecond * multiplier : demand;
      const rpm = aiDemand * 60;
      const limit = c.scaling.requestsPerMinuteLimit ?? 500;
      if (!c.scaling.requestsPerMinuteLimit) assumptions.push(`${c.name}: rate limit assumed at 500 requests/min.`);
      const handling = c.ai?.rateLimitHandling ?? "none";
      points.push(point(c, "provider rate limit (RPM)", rpm, limit, "req/min", ev,
        rpm > limit
          ? `${Math.round(rpm)} req/min exceeds the provider limit of ${limit}; HTTP 429s are returned${handling === "none" ? " and nothing queues or retries them, so users see errors" : ` and are handled by ${handling}`}.`
          : `${Math.round(rpm)} of ${limit} req/min.`));
      const tpm = rpm * (g.traffic?.avgTokensPerAiRequest ?? 1000);
      if (c.scaling.tokensPerMinuteLimit) {
        points.push(point(c, "provider rate limit (TPM)", tpm, c.scaling.tokensPerMinuteLimit, "tokens/min", ev,
          tpm > c.scaling.tokensPerMinuteLimit ? `${Math.round(tpm).toLocaleString("en-US")} tokens/min exceeds the ${c.scaling.tokensPerMinuteLimit.toLocaleString("en-US")} TPM limit.` : `${Math.round(tpm).toLocaleString("en-US")} of ${c.scaling.tokensPerMinuteLimit.toLocaleString("en-US")} tokens/min.`));
      }
    }

    if (c.type === "identity_provider" && c.scaling.requestsPerMinuteLimit) {
      const rpm = demand * 60;
      points.push(point(c, "provider rate limit", rpm, c.scaling.requestsPerMinuteLimit, "req/min", ev,
        rpm > c.scaling.requestsPerMinuteLimit ? `${Math.round(rpm)} req/min exceeds the identity provider's ${c.scaling.requestsPerMinuteLimit} req/min.` : `${Math.round(rpm)} of ${c.scaling.requestsPerMinuteLimit} req/min.`));
    }
  }

  const saturated = points.filter((p) => p.status === "saturated").sort((a, b) => b.utilization - a.utilization);
  return { multiplier, demandRps, points, firstFailure: saturated[0], saturated };
}

function point(c: Component, constraint: string, demand: number, capacity: number, unit: string, evidence: EvidenceLevel, mechanism: string): CapacityPoint {
  const utilization = capacity > 0 ? demand / capacity : Number.POSITIVE_INFINITY;
  return {
    componentId: c.id,
    name: c.name,
    constraint,
    demand: round(demand),
    capacity: round(capacity),
    unit,
    utilization: round(utilization),
    status: utilization > 1 ? "saturated" : utilization > 0.75 ? "warning" : "ok",
    mechanism,
    evidence,
  };
}

function computeBreakOrder(tiers: ScalabilityTier[]) {
  const seen = new Set<string>();
  const out: ScalabilityReport["breakOrder"] = [];
  for (const t of tiers) {
    for (const p of t.saturated) {
      const key = p.componentId + ":" + p.constraint;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ componentId: p.componentId, name: `${p.name} (${p.constraint})`, multiplier: t.multiplier, mechanism: p.mechanism });
    }
  }
  return out;
}

function deriveFindings(idx: GraphIndex, tiers: ScalabilityTier[], breakOrder: ScalabilityReport["breakOrder"], baseline: number): Finding[] {
  const findings: Finding[] = [];
  const g = idx.graph;
  const seenComponents = new Set<string>();
  for (const b of breakOrder) {
    if (seenComponents.has(b.componentId)) continue;
    seenComponents.add(b.componentId);
    const c = idx.component(b.componentId);
    const tier = tiers.find((t) => t.multiplier === b.multiplier)!;
    const p = tier.saturated.find((x) => x.componentId === b.componentId)!;
    const severity: Severity = b.multiplier <= 1 ? "critical" : b.multiplier <= 2 ? "critical" : b.multiplier <= 5 ? "high" : b.multiplier <= 10 ? "medium" : "low";
    const rec = recommendationFor(c, p);
    findings.push({
      id: `scale-${c.id}-${slug(p.constraint)}`,
      engine: "scalability",
      category: `bottleneck_${slug(p.constraint)}`,
      severity,
      confidence: p.evidence === "assumption" ? "low" : "medium",
      title: `${c.name} saturates at ${b.multiplier}x traffic (${Math.round(tier.demandRps)} rps): ${p.constraint} reaches ${Math.round(p.utilization * 100)}% of capacity.`,
      evidence: [
        { level: p.evidence, statement: `Estimate: demand ${p.demand} ${p.unit} vs capacity ${p.capacity} ${p.unit} at ${b.multiplier}x (baseline ${baseline} rps).`, componentIds: [c.id] },
        { level: "fact", statement: `Scaling model: ${c.scaling.model}${c.scaling.maxInstances ? `, max ${c.scaling.maxInstances} instances` : ""}${c.scaling.maxConnections ? `, max_connections ${c.scaling.maxConnections}` : ""}${c.scaling.connectionPooler === false ? ", no connection pooler" : ""}.` },
        { level: "inference", statement: p.mechanism },
      ],
      mechanism: p.mechanism,
      impact: b.multiplier <= 2
        ? "This limit is close to today's traffic; a marketing push or a single large tenant can trigger it."
        : `Requests depending on ${c.name} slow down and then fail once the limit is crossed; upstream services hold connections open and can cascade.`,
      recommendation: rec.text,
      tradeoff: rec.tradeoff,
      affectedComponentIds: [c.id, ...idx.dependents(c.id).map((e) => e.source)],
      affectedEdgeIds: idx.dependents(c.id).map((e) => e.id),
      dimensions: { scalability: 1, performance: 0.4 },
      fix: rec.fix,
      details: { multiplier: b.multiplier, demand: p.demand, capacity: p.capacity, unit: p.unit },
    });
  }
  void g;
  return findings;
}

function recommendationFor(c: Component, p: CapacityPoint) {
  if (p.constraint === "connections") {
    return {
      text: `Put a connection pooler (PgBouncer / built-in pooling) in front of ${c.name} in transaction mode and cap each application's pool so total connections stay under the server limit regardless of autoscaling.`,
      tradeoff: "Pooling in transaction mode breaks session-level features (prepared statements, advisory locks) unless configured carefully; adds one more component to run.",
      fix: { description: `Add connection pooling for ${c.name}`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, connectionPooler: true } } }] },
    };
  }
  if (p.constraint === "job throughput") {
    return {
      text: `Autoscale ${c.name} on queue depth (KEDA / queue-length based scaling) with a sensible maximum, and add a dead-letter queue so poison messages do not block the pool.`,
      tradeoff: "Burst scaling increases downstream load (embeddings, database writes) - those limits must be raised together.",
      fix: { description: `Autoscale ${c.name} on queue depth`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, model: "horizontal_auto" as const, minInstances: 2, maxInstances: 20 } } }] },
    };
  }
  if (p.constraint.startsWith("provider rate limit")) {
    return {
      text: `Queue AI work behind a gateway that enforces per-tenant budgets, retries with backoff on 429, caches repeated prompts and can route to a second model/provider when the primary is throttled. Request a higher tier from the provider before growth arrives.`,
      tradeoff: "Queued inference changes the UX (streaming/progress states); a second provider requires prompt compatibility testing.",
      fix: { description: `Handle rate limits on ${c.name}`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, requestsPerMinuteLimit: (c.scaling.requestsPerMinuteLimit ?? 500) * 10, tokensPerMinuteLimit: (c.scaling.tokensPerMinuteLimit ?? 300000) * 10 }, ai: { ...(c.ai ?? { role: "llm" as const }), rateLimitHandling: "queue" as const, responseCaching: true } } }] },
    };
  }
  if (p.constraint === "compute throughput") {
    return {
      text: `Raise the instance ceiling for ${c.name} (or move to autoscaling if it is fixed), and confirm the downstream data stores can absorb the extra connections.`,
      tradeoff: "More instances mean more connections and more cost; without a pooler this simply moves the bottleneck to the database.",
      fix: { description: `Raise scaling ceiling for ${c.name}`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, model: "horizontal_auto" as const, maxInstances: Math.max((c.scaling.maxInstances ?? 4) * 3, 12) } } }] },
    };
  }
  if (p.constraint === "write throughput (single primary)") {
    return {
      text: `Reduce write amplification (batch writes, move high-volume event data to an append-only store), then scale vertically; beyond that, partition tenants across shards.`,
      tradeoff: "Sharding is a large architectural change; vertical scaling has a hard ceiling and requires downtime windows.",
      fix: { description: `Batch writes / bigger primary for ${c.name}`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, maxWriteOps: (c.scaling.maxWriteOps ?? 2000) * 3 } } }] },
    };
  }
  if (p.constraint === "read throughput") {
    return {
      text: `Add read replicas for ${c.name} and route read-only queries to them; increase cache coverage for hot reads.`,
      tradeoff: "Replica lag means read-your-own-writes needs care; more replicas cost roughly one primary each.",
      fix: { description: `Read replicas for ${c.name}`, updateComponents: [{ id: c.id, patch: { scaling: { ...c.scaling, readReplicas: (c.scaling.readReplicas ?? 0) + 2 } } }] },
    };
  }
  if (p.constraint === "query throughput") {
    return {
      text: `Scale ${c.name} horizontally (sharded collection across nodes or a managed vector service) and add a result cache for repeated queries.`,
      tradeoff: "Cluster operations, re-sharding and cost; managed services trade control for simplicity.",
      fix: { description: `Scale out ${c.name}`, updateComponents: [{ id: c.id, patch: { redundancy: { ...c.redundancy, replicas: 3, multiAz: true, failover: "automatic" as const }, scaling: { ...c.scaling, model: "horizontal_auto" as const, maxReadOps: (c.scaling.maxReadOps ?? 100) * 3 } } }] },
    };
  }
  return {
    text: `Increase the capacity of ${c.name} or move to a tier/cluster mode that scales horizontally.`,
    tradeoff: "Cost and operational complexity.",
    fix: undefined,
  };
}

function round(n: number) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function dedupe(a: string[]) {
  return [...new Set(a)];
}
