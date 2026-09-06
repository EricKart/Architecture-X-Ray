import type { ArchitectureGraph } from "@/engine/graph/types";
import type { AnalysisReport, GraphPatch } from "@/engine/analysis/types";
import type { FailureResult, FailureScenario } from "@/engine/simulation/failure";
import type { RequestTrace } from "@/engine/simulation/trace";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] } & T;
  if (!res.ok) throw new Error(body.error ? `${body.error}${body.details?.length ? ` (${body.details[0]})` : ""}` : `Request failed (${res.status})`);
  return body;
}

export const api = {
  demo: () => call<{ graph: ArchitectureGraph }>("/api/demo"),
  analyze: (graph: ArchitectureGraph) => call<{ report: AnalysisReport }>("/api/analyze", { method: "POST", body: JSON.stringify({ graph }) }),
  simulate: (graph: ArchitectureGraph, scenario: FailureScenario) =>
    call<{ result: FailureResult }>("/api/simulate", { method: "POST", body: JSON.stringify({ graph, scenario }) }),
  trace: (graph: ArchitectureGraph, flowId: string) => call<{ trace: RequestTrace }>("/api/trace", { method: "POST", body: JSON.stringify({ graph, flowId }) }),
  fix: (graph: ArchitectureGraph, patch: GraphPatch) =>
    call<{ graph: ArchitectureGraph; report: AnalysisReport }>("/api/fix", { method: "POST", body: JSON.stringify({ graph, patch }) }),
};
