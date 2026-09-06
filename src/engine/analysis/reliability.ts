import type { ArchitectureGraph, Component } from "../graph/types";
import { indexGraph } from "../graph/queries";
import { simulateFailure, standardScenarios, type FailureResult } from "../simulation/failure";
import type { Finding, ScenarioSummary, Severity } from "./types";

/**
 * Reliability attack: fail every critical component, the region, a zone,
 * DNS, certificates, egress, the identity provider and the AI provider.
 * Findings are derived from the simulated blast radius, not from labels.
 */
export function analyzeReliability(graph: ArchitectureGraph): { findings: Finding[]; scenarios: ScenarioSummary[] } {
  const idx = indexGraph(graph);
  const findings: Finding[] = [];
  const scenarios: ScenarioSummary[] = [];
  const target = graph.targets?.availability;

  for (const scenario of standardScenarios(graph)) {
    const r = simulateFailure(graph, scenario);
    scenarios.push({
      id: scenarioId(scenario.kind, scenario.targetId),
      name: r.title,
      kind: scenario.kind,
      targetId: scenario.targetId,
      userImpact: r.userImpact,
      blastRadiusPct: r.blastRadiusPct,
      isSpof: r.isSpof,
      recovery: r.recovery,
      affectedCount: r.affected.length,
    });

    if (scenario.kind === "component" && r.isSpof && idx.zoneOf(scenario.targetId!)?.kind !== "external_saas") {
      const c = idx.component(scenario.targetId!);
      findings.push(spofFinding(graph, c, r));
    }
    if (scenario.kind === "region" && (r.userImpact === "total_outage" || r.userImpact === "high")) {
      const singleRegion = graph.components.filter((c) => c.regionId && !c.redundancy.multiRegion && c.criticality === "critical");
      const sev: Severity = target && target >= 99.95 ? "critical" : target && target >= 99.9 ? "high" : "medium";
      findings.push({
        id: "rel-single-region",
        engine: "reliability",
        category: "single_region",
        severity: sev,
        confidence: "high",
        title: `A single regional outage takes the whole product down: ${singleRegion.length} critical components have no deployment outside ${scenario.targetId}.`,
        evidence: [
          { level: "fact", statement: `Only one region is declared (${graph.regions.map((x) => x.name).join(", ")}).` },
          { level: "fact", statement: `Critical components without multi-region redundancy: ${singleRegion.map((c) => c.name).join(", ")}.`, componentIds: singleRegion.map((c) => c.id) },
          { level: "inference", statement: `Simulated region loss breaks ${r.flows.filter((f) => f.state === "down").length} of ${r.flows.length} flows (blast radius ${r.blastRadiusPct}%).` },
          target
            ? { level: "fact", statement: `Availability target is ${target}%; a regional incident typically lasts hours, which exceeds the annual error budget of ${errorBudget(target)}.` }
            : { level: "unknown", statement: "No availability target supplied; severity assumes a typical SaaS target of 99.9%." },
        ],
        mechanism: "All stateful and stateless components live in one region. A regional control-plane or networking incident removes every replica simultaneously; multi-AZ redundancy does not help because zones share the regional fault domain.",
        impact: "Complete outage for the duration of the regional incident plus the time to rebuild elsewhere. Data recovery is limited to whatever backups were copied out of the region.",
        recommendation: "Adopt at least a pilot-light DR posture: geo-replicate backups and object storage to a second region, keep IaC able to stand up the stack there, and rehearse failover. For RTO under an hour, run a warm standby with an asynchronous database replica.",
        tradeoff: "Roughly 20-60% additional infrastructure cost depending on posture, cross-region data transfer charges, and operational complexity around failover and DNS.",
        affectedComponentIds: singleRegion.map((c) => c.id),
        affectedEdgeIds: [],
        dimensions: { reliability: 1 },
        details: { blastRadiusPct: r.blastRadiusPct, flowsDown: r.flows.filter((f) => f.state === "down").length },
      });
    }
    if (scenario.kind === "availability_zone") {
      const singleZone = r.affected.filter((a) => a.depth === 0 && a.state === "down").map((a) => idx.component(a.componentId));
      const critical = singleZone.filter((c) => c.criticality === "critical" || c.criticality === "high");
      if (critical.length && (r.userImpact === "total_outage" || r.userImpact === "high" || r.userImpact === "partial")) {
        findings.push({
          id: "rel-single-az",
          engine: "reliability",
          category: "single_zone",
          severity: r.userImpact === "total_outage" || r.userImpact === "high" ? "high" : "medium",
          confidence: "medium",
          title: `Losing one availability zone takes down ${critical.length} important component(s) that are deployed in a single zone.`,
          evidence: [
            { level: "fact", statement: `Single-zone components: ${critical.map((c) => c.name).join(", ")}.`, componentIds: critical.map((c) => c.id) },
            { level: "assumption", statement: "Zone placement is not recorded, so the worst case (all single-zone resources in the failed zone) is assumed." },
            { level: "inference", statement: `Simulated impact: ${r.userImpact.replace("_", " ")}, blast radius ${r.blastRadiusPct}%.` },
          ],
          mechanism: "Zone-redundant compute keeps running but every request that touches a single-zone stateful dependency fails. The remaining healthy replicas cannot compensate for a dependency that no longer exists.",
          impact: "Zone incidents are the most common cloud failure; without zone redundancy on stateful components the 99.9% target is unlikely to hold.",
          recommendation: "Enable zone-redundant HA for managed data services (standby in another zone with automatic failover) and spread self-hosted stateful nodes across zones.",
          tradeoff: "Typically doubles the cost of the affected data services and adds a small write-latency overhead for synchronous replication.",
          affectedComponentIds: critical.map((c) => c.id),
          affectedEdgeIds: [],
          dimensions: { reliability: 0.8 },
        });
      }
    }
    if (scenario.kind === "identity_provider" && r.userImpact !== "none" && r.userImpact !== "low") {
      const idp = idx.byType("identity_provider");
      findings.push(externalDependencyFinding("rel-idp", "identity provider", idp, r, "Cache JWKS/public keys locally with a long grace period, keep issued sessions valid during provider outages, and avoid calling the provider on every request."));
    }
    if (scenario.kind === "ai_provider" && r.userImpact !== "none" && r.userImpact !== "low") {
      const ai = idx.byType("llm_provider", "embedding_service", "ml_inference");
      findings.push(externalDependencyFinding("rel-ai-provider", "AI model provider", ai, r, "Route model calls through a gateway with a secondary provider/model, per-tenant rate limiting and a circuit breaker so that non-AI features keep working during provider incidents."));
    }
    if (scenario.kind === "certificate" && r.seedIds.length) {
      const seeds = r.seedIds.map((id) => idx.component(id));
      findings.push({
        id: "rel-cert-expiry",
        engine: "reliability",
        category: "certificate_expiry",
        severity: r.userImpact === "total_outage" || r.userImpact === "high" ? "high" : "medium",
        confidence: "high",
        title: `Manually managed TLS certificates on ${seeds.map((s) => s.name).join(", ")} will eventually expire and take the endpoint offline.`,
        evidence: [
          { level: "fact", statement: `tlsCertificate = manual on ${seeds.map((s) => s.name).join(", ")}.`, componentIds: seeds.map((s) => s.id) },
          { level: "inference", statement: `Simulated expiry: user impact ${r.userImpact.replace("_", " ")}.` },
        ],
        mechanism: "Certificate expiry is a time bomb rather than a random failure: every client rejects the endpoint at the same instant, and it commonly happens at night or on a weekend.",
        impact: "Full API outage until someone issues and deploys a new certificate.",
        recommendation: "Use managed certificates (ACME / cloud-managed) on every public endpoint and add an expiry alert at 30 and 7 days.",
        tradeoff: "Minimal; may require moving TLS termination to a managed ingress or gateway.",
        affectedComponentIds: seeds.map((s) => s.id),
        affectedEdgeIds: [],
        dimensions: { reliability: 0.6, operability: 0.4 },
        fix: { description: "Switch to managed certificates", updateComponents: seeds.map((s) => ({ id: s.id, patch: { security: { tlsCertificate: "managed" as const } } })) },
      });
    }
  }

  // Backup posture on stateful components.
  for (const c of graph.components) {
    if (!c.stateful || c.type === "queue" || c.type === "stream") continue;
    if (c.type === "cache" && c.criticality !== "critical") continue;
    const rpo = graph.targets?.rpoMinutes;
    if (!c.backup?.enabled) {
      const holdsSessions = c.type === "cache";
      findings.push({
        id: `rel-no-backup-${c.id}`,
        engine: "reliability",
        category: "no_backup",
        severity: c.criticality === "critical" ? "high" : "medium",
        confidence: "high",
        title: `${c.name} holds state but has no backup; losing it means ${holdsSessions ? "every active session" : "the data"} is gone for good.`,
        evidence: [
          { level: "fact", statement: `${c.name}: stateful, backup.enabled = false, replicas = ${c.redundancy.replicas}.`, componentIds: [c.id] },
          { level: "inference", statement: `${idx.dependents(c.id).length} component(s) depend on it at runtime.` },
        ],
        mechanism: holdsSessions
          ? "A single-node cache used as the session store is a database in disguise. A restart, eviction under memory pressure or node failure logs every user out at once and drops rate-limit state."
          : `No point-in-time copy exists. Corruption, an accidental delete, or a failed migration on ${c.name} cannot be undone.`,
        impact: holdsSessions ? "Mass logout and a login storm against the identity provider; degraded experience across all tenants." : "Permanent data loss; for vector data this means re-embedding every document at full LLM cost.",
        recommendation: holdsSessions
          ? "Move to a Standard/Premium tier with replication and persistence, or make sessions stateless (signed tokens) so the cache is a pure accelerator."
          : "Enable scheduled snapshots (and PITR where available) with retention matched to the RPO, and copy them to another region.",
        tradeoff: "Higher tier cost and, for PITR, a little extra I/O and storage.",
        affectedComponentIds: [c.id],
        affectedEdgeIds: [],
        dimensions: { reliability: 0.7 },
        fix: { description: `Enable backups on ${c.name}`, updateComponents: [{ id: c.id, patch: { backup: { enabled: true, pointInTimeRecovery: true, restoreTested: false, frequency: "continuous" } } }] },
      });
    } else if (c.backup.enabled && rpo && !c.backup.pointInTimeRecovery && c.criticality === "critical") {
      findings.push({
        id: `rel-rpo-${c.id}`,
        engine: "reliability",
        category: "rpo_mismatch",
        severity: "high",
        confidence: "high",
        title: `${c.name} is backed up ${c.backup.frequency ?? "periodically"} without point-in-time recovery, so the achievable RPO is far worse than the ${rpo}-minute target.`,
        evidence: [
          { level: "fact", statement: `Backup frequency: ${c.backup.frequency ?? "unspecified"}; PITR disabled; restoreTested = ${c.backup.restoreTested ?? "unknown"}.`, componentIds: [c.id] },
          { level: "fact", statement: `Stated RPO target: ${rpo} minutes.` },
        ],
        mechanism: "Without continuous WAL/transaction-log archiving, any restore lands on the last full backup. Every write since then is lost.",
        impact: "Up to a full day of tenant data (documents, chats, billing events) lost after a corruption or deletion event.",
        recommendation: "Enable point-in-time recovery (continuous log backup), shorten the snapshot interval, replicate backups to a second region, and rehearse a restore quarterly.",
        tradeoff: "Modest storage cost for log retention; a restore rehearsal needs engineering time.",
        affectedComponentIds: [c.id],
        affectedEdgeIds: [],
        dimensions: { reliability: 0.8 },
        fix: { description: `Enable PITR on ${c.name}`, updateComponents: [{ id: c.id, patch: { backup: { ...c.backup, pointInTimeRecovery: true, crossRegion: true } } }] },
      });
    }
  }

  // Synchronous external calls without timeouts/circuit breakers.
  for (const e of graph.edges) {
    if (e.sync !== "sync" || !idx.leavesOrganisation(e)) continue;
    const tgt = idx.component(e.target);
    const src = idx.component(e.source);
    if (tgt.type === "identity_provider" && e.fallback) continue;
    if (!e.timeoutMs || !e.circuitBreaker) {
      findings.push({
        id: `rel-no-cb-${e.id}`,
        engine: "reliability",
        category: "no_circuit_breaker",
        severity: tgt.type === "llm_provider" ? "high" : "medium",
        confidence: e.timeoutMs === undefined ? "medium" : "high",
        title: `${src.name} calls ${tgt.name} synchronously in the request path with ${e.timeoutMs ? `a ${e.timeoutMs / 1000}s timeout` : "no timeout"} and no circuit breaker.`,
        evidence: [
          { level: "fact", statement: `Edge ${src.name} -> ${tgt.name}: sync, hard, timeoutMs = ${e.timeoutMs ?? "unset"}, circuitBreaker = ${e.circuitBreaker ?? false}, retries = ${e.retries ?? 0}.`, edgeIds: [e.id] },
          { level: "inference", statement: `${tgt.name} is an external SaaS dependency outside the organisation's control.` },
        ],
        mechanism: "When the provider slows down, each in-flight request holds a worker/connection for the full timeout. Concurrency climbs until the pool is exhausted and the service stops answering unrelated requests as well - a slow dependency becomes a total outage.",
        impact: "Provider latency incidents cascade into outages of features that do not even use the provider.",
        recommendation: "Set an aggressive timeout (a few seconds for non-streaming calls), add a circuit breaker with a fallback (cached answer, degraded response, secondary provider), and bound concurrency with a bulkhead.",
        tradeoff: "Some requests fail fast instead of eventually succeeding; needs product decisions about degraded behaviour.",
        affectedComponentIds: [src.id, tgt.id],
        affectedEdgeIds: [e.id],
        dimensions: { reliability: 0.6, performance: 0.5 },
        fix: { description: `Add timeout + circuit breaker on ${src.name} -> ${tgt.name}`, updateEdges: [{ id: e.id, patch: { timeoutMs: 8000, circuitBreaker: true, retries: 1, fallback: "circuit breaker: degraded response" } }] },
      });
    }
  }

  return { findings, scenarios };
}

function spofFinding(graph: ArchitectureGraph, c: Component, r: FailureResult): Finding {
  const downFlows = r.flows.filter((f) => f.state === "down");
  const dependents = r.affected.filter((a) => a.depth > 0 && a.state === "down").map((a) => a.name);
  const severity: Severity = r.userImpact === "total_outage" ? "critical" : r.userImpact === "high" ? "critical" : r.userImpact === "partial" ? "high" : "medium";
  const recoveryTxt = r.recovery === "none" ? "there is no recovery path" : r.recovery === "manual" ? "recovery is manual" : "recovery is automatic";
  const fix = spofFix(c);
  return {
    id: `rel-spof-${c.id}`,
    engine: "reliability",
    category: "single_point_of_failure",
    severity,
    confidence: "high",
    title: `${c.name} is a single point of failure: one instance, no failover, and ${downFlows.length} of ${r.flows.length} flows stop when it disappears.`,
    evidence: [
      { level: "fact", statement: `${c.name}: replicas = ${c.redundancy.replicas}, multiAz = ${c.redundancy.multiAz}, failover = ${c.redundancy.failover}.`, componentIds: [c.id] },
      { level: "inference", statement: `Hard synchronous dependents that go down with it: ${dependents.length ? dependents.join(", ") : "none directly, but flows are interrupted"}.`, componentIds: r.affected.filter((a) => a.depth > 0).map((a) => a.componentId) },
      { level: "inference", statement: `Broken flows: ${downFlows.map((f) => f.name).join(", ") || "none"}; blast radius ${r.blastRadiusPct}%; ${recoveryTxt}.` },
    ],
    mechanism: `Dependents hold synchronous edges to ${c.name} with no fallback. When it fails, requests block until timeout and then error; nothing in the graph can take over its role.`,
    impact: `User impact ${r.userImpact.replace("_", " ")}. Expected recovery: ${r.estimatedRecovery}. Data loss: ${r.dataLoss}.`,
    recommendation: fix.description,
    tradeoff: fix.tradeoff,
    affectedComponentIds: [c.id, ...r.affected.filter((a) => a.depth > 0).map((a) => a.componentId)],
    affectedEdgeIds: r.affected.filter((a) => a.viaEdgeId).map((a) => a.viaEdgeId!) ,
    dimensions: { reliability: 1 },
    fix: fix.patch,
    details: { blastRadiusPct: r.blastRadiusPct, flowsDown: downFlows.length, recovery: r.recovery },
  };
}

function spofFix(c: Component) {
  if (c.type === "relational_db" || c.type === "document_db") {
    return {
      description: `Enable zone-redundant high availability on ${c.name} with a synchronous standby and automatic failover, and add a read replica for read scaling.`,
      tradeoff: "Roughly 2x database cost; failover still causes a 30-120 s interruption; applications must reconnect gracefully.",
      patch: { description: `Zone-redundant HA for ${c.name}`, updateComponents: [{ id: c.id, patch: { redundancy: { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic" as const, failoverSeconds: 60 }, cost: { ...c.cost, monthlyUsd: c.cost.monthlyUsd ? { min: c.cost.monthlyUsd.min * 2, max: c.cost.monthlyUsd.max * 2 } : undefined } } }] },
    };
  }
  if (c.type === "cache") {
    return {
      description: `Move ${c.name} to a replicated tier (primary + replica across zones, automatic failover) and stop treating it as the only copy of session state.`,
      tradeoff: "About 2-3x cache cost; sessions still need to tolerate a brief failover.",
      patch: { description: `Replicated cache tier for ${c.name}`, updateComponents: [{ id: c.id, patch: { redundancy: { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic" as const, failoverSeconds: 30 }, backup: { enabled: true, frequency: "hourly RDB" }, service: "Azure Cache for Redis - Standard C1 (replicated)", cost: { ...c.cost, monthlyUsd: { min: 100, max: 150 } } } }] },
    };
  }
  if (c.type === "vector_db") {
    return {
      description: `Run ${c.name} as a 3-node cluster (or a managed vector service) with snapshots to object storage.`,
      tradeoff: "Roughly 3x the VM cost or a managed-service premium; adds an operational component if self-managed.",
      patch: { description: `Cluster ${c.name}`, updateComponents: [{ id: c.id, patch: { redundancy: { replicas: 3, multiAz: true, multiRegion: false, failover: "automatic" as const, failoverSeconds: 30 }, backup: { enabled: true, frequency: "hourly snapshot to object storage" }, scaling: { ...c.scaling, model: "horizontal_auto" as const, maxReadOps: (c.scaling.maxReadOps ?? 200) * 3 }, cost: { ...c.cost, monthlyUsd: c.cost.monthlyUsd ? { min: c.cost.monthlyUsd.min * 3, max: c.cost.monthlyUsd.max * 3 } : undefined } } }] },
    };
  }
  if (c.type === "nat_gateway") {
    return {
      description: `Deploy zone-redundant egress (one NAT gateway per zone or a zone-redundant SKU) so a zonal NAT failure does not sever outbound traffic.`,
      tradeoff: "Additional fixed hourly cost per gateway.",
      patch: { description: "Zone-redundant NAT", updateComponents: [{ id: c.id, patch: { redundancy: { replicas: 3, multiAz: true, multiRegion: false, failover: "automatic" as const } } }] },
    };
  }
  return {
    description: `Run at least two instances of ${c.name} across zones behind a health-checked endpoint with automatic replacement.`,
    tradeoff: "Doubles the component's cost; stateful components additionally need replication.",
    patch: { description: `Add redundancy to ${c.name}`, updateComponents: [{ id: c.id, patch: { redundancy: { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic" as const, failoverSeconds: 60 } } }] },
  };
}

function externalDependencyFinding(id: string, label: string, comps: Component[], r: FailureResult, recommendation: string): Finding {
  const downFlows = r.flows.filter((f) => f.state === "down");
  return {
    id,
    engine: "reliability",
    category: "external_dependency",
    severity: r.userImpact === "total_outage" ? "critical" : r.userImpact === "high" ? "high" : "medium",
    confidence: "high",
    title: `An outage at the ${label} (${comps.map((c) => c.name).join(", ")}) breaks ${downFlows.length} of ${r.flows.length} flows with no fallback.`,
    evidence: [
      { level: "fact", statement: `${comps.map((c) => `${c.name}: fallback provider = ${c.ai?.fallbackProvider ?? "none"}`).join("; ")}.`, componentIds: comps.map((c) => c.id) },
      { level: "inference", statement: `Simulated outage: user impact ${r.userImpact.replace("_", " ")}, affected: ${r.affected.filter((a) => a.depth > 0).map((a) => a.name).join(", ") || "none"}.` },
    ],
    mechanism: "The dependency sits outside the organisation's control and is called synchronously on hard edges. Its availability becomes an upper bound on the product's availability.",
    impact: `Flows interrupted: ${downFlows.map((f) => f.name).join(", ") || "none"}. Recovery depends entirely on the provider.`,
    recommendation,
    tradeoff: "A second provider means prompt/behaviour drift, extra contracts and testing; caching tokens/keys adds security review.",
    affectedComponentIds: comps.map((c) => c.id),
    affectedEdgeIds: [],
    dimensions: { reliability: 0.8, ai: comps.some((c) => c.ai) ? 0.8 : 0 },
  };
}

export function scenarioId(kind: string, targetId?: string) {
  return targetId ? `${kind}:${targetId}` : kind;
}

function errorBudget(target: number): string {
  const minutes = (1 - target / 100) * 365 * 24 * 60;
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} hours/year` : `${minutes.toFixed(0)} minutes/year`;
}
