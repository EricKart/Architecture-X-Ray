import type { ArchitectureGraph, DataFlow, Edge } from "../graph/types";
import { indexGraph } from "../graph/queries";

/**
 * "Follow a request": turns a DataFlow into an annotated trace, enriching each
 * step with the edge properties (protocol, sync/async, encryption, auth,
 * boundary crossing) so the UI can explain what happens at each hop.
 */
export interface TraceStep {
  index: number;
  componentId: string;
  componentName: string;
  componentType: string;
  zoneName: string;
  action: string;
  detail?: string;
  edge?: {
    id: string;
    kind: Edge["kind"];
    protocol?: string;
    sync: "sync" | "async";
    encrypted: boolean | "unknown";
    authentication: string;
    crossesTrustBoundary: boolean;
    leavesOrganisation: boolean;
    timeoutMs?: number;
    fallback?: string;
  };
  /** Latency estimate for this hop in ms (assumption, typed by protocol/component). */
  estimatedLatencyMs: number;
  warnings: string[];
}

export interface RequestTrace {
  flowId: string;
  name: string;
  kind: DataFlow["kind"];
  description: string;
  steps: TraceStep[];
  estimatedTotalLatencyMs: number;
  syncHops: number;
  asyncHops: number;
  warnings: string[];
}

const HOP_LATENCY: Record<string, number> = {
  dns: 20, cdn: 15, waf: 15, load_balancer: 2, api_gateway: 5, service: 8, worker: 0,
  identity_provider: 120, cache: 1, relational_db: 6, document_db: 6, vector_db: 40,
  object_storage: 60, queue: 5, llm_provider: 2500, embedding_service: 300, llm_gateway: 10,
  nat_gateway: 1, web_frontend: 30, client: 0,
};

export function traceFlow(graph: ArchitectureGraph, flowId: string): RequestTrace {
  const idx = indexGraph(graph);
  const flow = graph.flows.find((f) => f.id === flowId);
  if (!flow) throw new Error(`Unknown flow: ${flowId}`);
  const warnings: string[] = [];
  let total = 0;
  let syncHops = 0;
  let asyncHops = 0;
  const steps: TraceStep[] = flow.steps.map((s, i) => {
    const c = idx.component(s.componentId);
    const zone = idx.zones.get(c.zoneId);
    const e = s.edgeId ? idx.edges.get(s.edgeId) : undefined;
    const stepWarnings: string[] = [];
    let latency = HOP_LATENCY[c.type] ?? 5;
    if (c.type === "llm_provider" && e?.sync === "sync") latency = 2500;
    if (e) {
      if (e.sync === "sync") syncHops += 1; else asyncHops += 1;
      if (e.encrypted === false) stepWarnings.push("Traffic on this hop is not encrypted.");
      if (e.authentication === "none") stepWarnings.push("No authentication on this hop.");
      if (idx.leavesOrganisation(e) && e.dataClassification && ["pii", "confidential", "regulated"].includes(e.dataClassification))
        stepWarnings.push(`${e.dataClassification.toUpperCase()} data leaves the organisation to ${c.name}.`);
      if (e.sync === "sync" && (c.type === "llm_provider" || c.type === "external_api") && !e.timeoutMs)
        stepWarnings.push("Synchronous external call with no timeout configured.");
      if (e.sync === "sync" && e.timeoutMs && e.timeoutMs >= 30_000)
        stepWarnings.push(`Timeout of ${e.timeoutMs / 1000}s holds a request slot open for a long time under provider slowness.`);
      if (e.sync === "sync" && !e.circuitBreaker && idx.leavesOrganisation(e) && e.criticality === "hard")
        stepWarnings.push("No circuit breaker: provider slowness propagates back to users.");
    }
    if (e?.sync !== "async") total += latency;
    warnings.push(...stepWarnings.map((w) => `${c.name}: ${w}`));
    return {
      index: i,
      componentId: c.id,
      componentName: c.name,
      componentType: c.type,
      zoneName: zone?.name ?? c.zoneId,
      action: s.action,
      detail: s.detail,
      edge: e
        ? {
            id: e.id,
            kind: e.kind,
            protocol: e.protocol,
            sync: e.sync,
            encrypted: e.encrypted === undefined ? "unknown" : e.encrypted,
            authentication: e.authentication ?? "unknown",
            crossesTrustBoundary: idx.crossesTrustBoundary(e),
            leavesOrganisation: idx.leavesOrganisation(e),
            timeoutMs: e.timeoutMs,
            fallback: e.fallback,
          }
        : undefined,
      estimatedLatencyMs: latency,
      warnings: stepWarnings,
    };
  });
  return {
    flowId: flow.id,
    name: flow.name,
    kind: flow.kind,
    description: flow.description,
    steps,
    estimatedTotalLatencyMs: total,
    syncHops,
    asyncHops,
    warnings,
  };
}
