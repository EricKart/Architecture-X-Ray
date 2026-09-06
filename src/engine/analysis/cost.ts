import type { ArchitectureGraph, Component, ComponentType } from "../graph/types";
import { indexGraph } from "../graph/queries";
import type { CostCategory, CostLine, CostOptimization, CostReport, Finding } from "./types";

/**
 * Cost attack. Two responsibilities:
 *  1. Estimate the monthly/annual bill from component cost profiles. When a
 *     component carries no figure, a type-based range is ASSUMED and labelled.
 *  2. Try to make the architecture cheaper: overprovisioning, premium models
 *     for everything, log retention, single-provider egress, storage tiers.
 * Never fabricates vendor prices; everything is a range with a stated basis.
 */

const CATEGORY_FOR_TYPE: Record<ComponentType, CostCategory> = {
  client: "other", dns: "networking", cdn: "networking", waf: "security", load_balancer: "networking", api_gateway: "networking",
  identity_provider: "security", web_frontend: "compute", service: "compute", worker: "compute", serverless_function: "compute",
  container_platform: "compute", queue: "queues", stream: "queues", cache: "caching", relational_db: "database", document_db: "database",
  vector_db: "ai", search: "database", object_storage: "storage", llm_provider: "ai", embedding_service: "ai", ml_inference: "ai",
  llm_gateway: "ai", monitoring: "observability", logging: "observability", tracing: "observability", secrets_manager: "security",
  kms: "security", ci_cd: "other", external_api: "other", payment_provider: "other", email_service: "other", nat_gateway: "networking",
  vpn: "networking", bastion: "security", private_link: "networking", scheduler: "other",
};

/** Assumed monthly ranges (USD) when no figure is supplied. Deliberately wide. */
const ASSUMED_RANGE: Partial<Record<ComponentType, [number, number]>> = {
  dns: [0, 20], cdn: [20, 300], waf: [20, 400], load_balancer: [20, 60], api_gateway: [30, 300], identity_provider: [0, 800],
  web_frontend: [10, 100], service: [150, 600], worker: [80, 400], serverless_function: [5, 200], container_platform: [70, 300],
  queue: [10, 100], stream: [50, 400], cache: [40, 300], relational_db: [100, 1500], document_db: [60, 1200], vector_db: [70, 800],
  search: [80, 800], object_storage: [20, 300], llm_provider: [200, 4000], embedding_service: [20, 400], ml_inference: [200, 2000],
  llm_gateway: [30, 150], monitoring: [50, 600], logging: [50, 600], tracing: [30, 300], secrets_manager: [2, 30], kms: [2, 30],
  ci_cd: [0, 100], external_api: [0, 300], payment_provider: [0, 200], email_service: [10, 200], nat_gateway: [35, 150], vpn: [30, 150],
  bastion: [10, 60], private_link: [8, 60], scheduler: [0, 20],
};

export function analyzeCost(graph: ArchitectureGraph): { findings: Finding[]; report: CostReport } {
  const assumptions: string[] = ["Figures are monthly USD ranges, not quotes. Where a component carries no cost profile a type-based range is assumed."];
  const lines: CostLine[] = [];
  for (const c of graph.components) {
    if (c.type === "client" || c.cost.model === "free") continue;
    const assumed = !c.cost.monthlyUsd;
    const fallback = ASSUMED_RANGE[c.type] ?? [10, 100];
    const min = c.cost.monthlyUsd ? c.cost.monthlyUsd.min : fallback[0];
    const max = c.cost.monthlyUsd ? c.cost.monthlyUsd.max : fallback[1];
    lines.push({
      componentId: c.id,
      name: c.name,
      category: CATEGORY_FOR_TYPE[c.type],
      min,
      max,
      model: c.cost.model,
      evidence: assumed ? "assumption" : c.evidence === "fact" ? "inference" : c.evidence,
      assumption: assumed ? `No figure supplied for ${c.name}; typical range for a ${c.type.replace("_", " ")} assumed.` : c.cost.notes,
    });
  }
  const monthly = { min: sum(lines, "min"), max: sum(lines, "max") };
  const byCategoryMap = new Map<CostCategory, { min: number; max: number }>();
  for (const l of lines) {
    const cur = byCategoryMap.get(l.category) ?? { min: 0, max: 0 };
    cur.min += l.min;
    cur.max += l.max;
    byCategoryMap.set(l.category, cur);
  }
  const byCategory = [...byCategoryMap.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.max - a.max);

  const { optimizations, findings } = optimize(graph, lines);
  const savingsMin = optimizations.reduce((a, o) => a + o.savingsMin, 0);
  const savingsMax = optimizations.reduce((a, o) => a + o.savingsMax, 0);

  return {
    findings,
    report: {
      currency: "USD",
      monthly,
      annual: { min: monthly.min * 12, max: monthly.max * 12 },
      byCategory,
      lines,
      optimizations,
      optimizedMonthly: { min: Math.max(0, monthly.min - savingsMin), max: Math.max(0, monthly.max - savingsMax) },
      assumptions,
    },
  };
}

function optimize(graph: ArchitectureGraph, lines: CostLine[]) {
  const idx = indexGraph(graph);
  const optimizations: CostOptimization[] = [];
  const findings: Finding[] = [];
  const lineOf = (id: string) => lines.find((l) => l.componentId === id);
  const baseline = graph.traffic?.baselineRps ?? 50;

  for (const c of graph.components) {
    const line = lineOf(c.id);
    if (!line) continue;

    // Overprovisioned compute: fixed minimum far above baseline need.
    if ((c.type === "service" || c.type === "worker") && c.scaling.minInstances && c.scaling.rpsPerInstance) {
      const share = shareOf(idx, c.id);
      const needed = Math.max(2, Math.ceil((baseline * share * 1.5) / c.scaling.rpsPerInstance));
      if (c.scaling.minInstances > needed * 1.5) {
        const frac = 1 - needed / c.scaling.minInstances;
        push(optimizations, findings, c, line, frac * 0.8, frac,
          `${c.name} keeps ${c.scaling.minInstances} instances running at all times, while ~${needed} would cover baseline traffic with 50% headroom.`,
          [{ level: "fact", statement: `minInstances = ${c.scaling.minInstances}, rpsPerInstance = ${c.scaling.rpsPerInstance}.`, componentIds: [c.id] },
           { level: "inference", statement: `Baseline share ${Math.round(share * 100)}% of ${baseline} rps = ${Math.round(baseline * share)} rps -> ${needed} instances with headroom.` }],
          "Reserved capacity is paid for 24x7 whether or not requests arrive. Autoscaling already exists; only the floor is wrong.",
          `Lower minInstances to ${needed} and let the autoscaler handle peaks; keep a scheduled scale-up before known traffic events.`,
          "Slightly slower reaction to sudden spikes; cold-start latency on scale-out.",
          { scaling: { ...c.scaling, minInstances: needed, currentInstances: needed }, cost: { ...c.cost, monthlyUsd: line ? { min: Math.round(line.min * (1 - frac)), max: Math.round(line.max * (1 - frac)) } : undefined } },
          "overprovisioned_compute");
      }
    }

    // Oversized database with low utilisation noted in the profile.
    if ((c.type === "relational_db" || c.type === "document_db") && c.cost.category === "very_high") {
      const util = /(\d+)%/.exec(c.cost.notes ?? "");
      const pct = util ? Number(util[1]) : undefined;
      if (pct !== undefined && pct < 25) {
        push(optimizations, findings, c, line, 0.4, 0.6,
          `${c.name} is a very high tier running at ~${pct}% CPU; a tier two sizes smaller would still leave headroom.`,
          [{ level: "fact", statement: `Cost note: "${c.cost.notes}".`, componentIds: [c.id] },
           { level: "inference", statement: "Memory-optimised, high-vCPU tiers are priced for sustained load; average utilisation this low indicates the size was chosen for safety, not need." }],
          "Provisioned database tiers bill per vCPU-hour regardless of query volume.",
          "Right-size to a general-purpose tier with roughly half the vCPUs and spend part of the saving on zone-redundant HA, which addresses the reliability finding at the same time.",
          "Less burst headroom; resizing requires a short maintenance window.",
          { technology: (c.technology ?? "").replace(/Memory Optimised.*$/i, "General Purpose D8ds_v5 (8 vCPU / 32 GB)"), cost: { ...c.cost, category: "high" as const, monthlyUsd: { min: Math.round(line.min * 0.5), max: Math.round(line.max * 0.6) } } },
          "oversized_database");
      }
    }

    // Premium LLM for every request, no caching, no routing.
    if (c.type === "llm_provider" && c.ai) {
      const issues: string[] = [];
      if (!c.ai.modelRouting) issues.push("a single premium model handles every request, including short classification and summarisation calls");
      if (!c.ai.responseCaching) issues.push("identical prompts are never cached");
      if (!c.ai.costCap) issues.push("there is no per-tenant spend cap");
      if (issues.length) {
        push(optimizations, findings, c, line, issues.length >= 2 ? 0.3 : 0.15, issues.length >= 2 ? 0.5 : 0.25,
          `${c.name} spend is unmanaged: ${issues.join("; ")}.`,
          [{ level: "fact", statement: `modelRouting = ${c.ai.modelRouting ?? false}, responseCaching = ${c.ai.responseCaching ?? false}, costCap = ${c.ai.costCap ?? false}.`, componentIds: [c.id] },
           { level: "assumption", statement: "Savings assume 40-60% of calls are short/simple tasks that a smaller model handles at roughly 1/10th of the token price." }],
          "Token pricing is linear in usage; every request routed to the largest model and every uncached repeat is money spent for no quality gain. Without a cap, a single abusive tenant or a bug in a retry loop sets the bill.",
          "Route by task (small model for classification/extraction, premium for generation), cache prompt prefixes and repeated answers, set per-tenant token budgets with alerts, and batch offline jobs.",
          "Routing logic to maintain and evaluate; caching needs invalidation rules; budgets need product decisions for over-limit tenants.",
          { ai: { ...c.ai, modelRouting: true, responseCaching: true, costCap: true }, cost: { ...c.cost, monthlyUsd: { min: Math.round(line.min * 0.5), max: Math.round(line.max * 0.7) } } },
          "unmanaged_ai_spend");
      }
    }

    // Observability retention.
    if ((c.type === "monitoring" || c.type === "logging") && (c.observability.logRetentionDays ?? 30) > 90 && c.cost.category !== "low") {
      push(optimizations, findings, c, line, 0.35, 0.55,
        `${c.name} retains all logs for ${c.observability.logRetentionDays} days in the hot tier; most debugging happens within 14 days.`,
        [{ level: "fact", statement: `logRetentionDays = ${c.observability.logRetentionDays}; cost category ${c.cost.category}${c.cost.notes ? ` (${c.cost.notes})` : ""}.`, componentIds: [c.id] }],
        "Interactive log storage is priced per GB-month; a year of container logs is mostly never queried.",
        "Keep 30 days interactive, archive the rest to cold storage/basic tier, sample debug-level logs, and drop noisy health-check lines at ingestion.",
        "Slower queries against archived data; audit-relevant logs must be explicitly exempted.",
        { observability: { ...c.observability, logRetentionDays: 30 }, cost: { ...c.cost, category: "medium" as const, monthlyUsd: { min: Math.round(line.min * 0.45), max: Math.round(line.max * 0.65) } } },
        "log_retention");
    }

    // Object storage without lifecycle policy.
    if (c.type === "object_storage" && c.cost.lifecyclePolicy === false) {
      push(optimizations, findings, c, line, 0.2, 0.4,
        `${c.name} keeps every object in the hot tier forever; no lifecycle policy moves cold documents to cheaper tiers.`,
        [{ level: "fact", statement: `lifecyclePolicy = false on ${c.name}.`, componentIds: [c.id] },
         { level: "assumption", statement: "Assumes most uploaded documents are rarely read after 30 days." }],
        "Hot storage costs several times more than cool/archive tiers; uploads accumulate monotonically in a document product.",
        "Add a lifecycle rule (hot -> cool after 30 days, archive after 180) and delete derived artifacts that can be regenerated.",
        "Retrieval latency and per-GB retrieval fees for cold tiers.",
        { cost: { ...c.cost, lifecyclePolicy: true, monthlyUsd: { min: Math.round(line.min * 0.6), max: Math.round(line.max * 0.8) } } },
        "storage_lifecycle");
    }

    // NAT egress for AI traffic where a private endpoint would avoid processing fees.
    if (c.type === "nat_gateway") {
      const aiViaNat = idx.dependents(c.id).filter((e) => idx.dependencies(e.source).some((d) => ["llm_provider", "embedding_service"].includes(idx.component(d.target).type)));
      if (aiViaNat.length) {
        push(optimizations, findings, c, line, 0.3, 0.6,
          `${c.name} meters every byte of LLM and embedding traffic from ${aiViaNat.map((e) => idx.component(e.source).name).join(", ")}.`,
          [{ level: "fact", statement: `${aiViaNat.length} AI-calling workloads egress via ${c.name}${c.cost.notes ? ` (${c.cost.notes})` : ""}.`, componentIds: [c.id, ...aiViaNat.map((e) => e.source)] }],
          "NAT gateways charge per GB processed; embeddings of large document corpora and long prompts add up.",
          "Use an in-cloud model endpoint reachable over private link (no NAT processing), and compress/trim prompts and chunk payloads.",
          "Provider choice becomes coupled to the cloud; private endpoints have their own hourly cost.",
          { cost: { ...c.cost, monthlyUsd: { min: Math.round(line.min * 0.5), max: Math.round(line.max * 0.6) } } },
          "nat_egress");
      }
    }
  }
  return { optimizations, findings };
}

function push(
  optimizations: CostOptimization[],
  findings: Finding[],
  c: Component,
  line: CostLine,
  fracMin: number,
  fracMax: number,
  title: string,
  evidence: Finding["evidence"],
  mechanism: string,
  recommendation: string,
  tradeoff: string,
  patch: Record<string, unknown>,
  category: string,
) {
  const savingsMin = Math.round(line.min * fracMin);
  const savingsMax = Math.round(line.max * fracMax);
  const id = `cost-${category}-${c.id}`;
  optimizations.push({ id, title, componentIds: [c.id], savingsMin, savingsMax, assumption: evidence.find((e) => e.level === "assumption")?.statement ?? "Savings proportional to the component's current range.", findingId: id });
  findings.push({
    id,
    engine: "cost",
    category,
    severity: savingsMax >= 1000 ? "high" : savingsMax >= 250 ? "medium" : "low",
    confidence: line.evidence === "assumption" ? "low" : "medium",
    title,
    evidence,
    mechanism,
    impact: `Estimated waste: $${savingsMin.toLocaleString()} - $${savingsMax.toLocaleString()} per month ($${(savingsMin * 12).toLocaleString()} - $${(savingsMax * 12).toLocaleString()} per year).`,
    recommendation,
    tradeoff,
    affectedComponentIds: [c.id],
    affectedEdgeIds: [],
    dimensions: { cost: 1 },
    fix: { description: `Optimise ${c.name}`, updateComponents: [{ id: c.id, patch }] },
    details: { savingsMin, savingsMax },
  });
}

function shareOf(idx: ReturnType<typeof indexGraph>, id: string): number {
  const flows = idx.graph.flows;
  if (!flows.length) return 1;
  const total = flows.reduce((a, f) => a + (f.trafficShare ?? 1 / flows.length), 0) || 1;
  return flows.filter((f) => f.steps.some((s) => s.componentId === id)).reduce((a, f) => a + (f.trafficShare ?? 1 / flows.length), 0) / total;
}

function sum(lines: CostLine[], key: "min" | "max") {
  return lines.reduce((a, l) => a + l[key], 0);
}
