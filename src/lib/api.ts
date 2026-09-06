import type { ArchitectureGraph } from "@/engine/graph/types";
import type { AnalysisReport, Finding, GraphPatch } from "@/engine/analysis/types";
import type { FailureResult, FailureScenario } from "@/engine/simulation/failure";
import type { RequestTrace } from "@/engine/simulation/trace";
import type { Requirements, InferenceResult } from "@/engine/architect/requirements";
import type { ArchitectPackage } from "@/engine/architect";
import type { IngestInput, IngestResult } from "@/engine/ingestion";
import type { Explanation } from "@/engine/teaching/explain";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] } & T;
  if (!res.ok) throw new Error(body.error ? `${body.error}${body.details?.length ? ` (${body.details.slice(0, 3).join("; ")})` : ""}` : `Request failed (${res.status})`);
  return body;
}

const post = <T>(path: string, payload: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(payload) });

export const api = {
  health: () => call<{ ok: boolean; ai: boolean }>("/api/health"),
  demo: () => call<{ graph: ArchitectureGraph }>("/api/demo"),
  analyze: (graph: ArchitectureGraph) => post<{ report: AnalysisReport }>("/api/analyze", { graph }),
  simulate: (graph: ArchitectureGraph, scenario: FailureScenario) => post<{ result: FailureResult }>("/api/simulate", { graph, scenario }),
  trace: (graph: ArchitectureGraph, flowId: string) => post<{ trace: RequestTrace }>("/api/trace", { graph, flowId }),
  fix: (graph: ArchitectureGraph, patch: GraphPatch) => post<{ graph: ArchitectureGraph; report: AnalysisReport }>("/api/fix", { graph, patch }),
  ingest: (input: IngestInput) => post<IngestResult>("/api/ingest", input),
  infer: (brief: string, base?: Requirements) => post<InferenceResult>("/api/architect/infer", { brief, base }),
  generate: (requirements: Requirements) => post<{ package: ArchitectPackage }>("/api/architect/generate", { requirements }),
  explain: (graph: ArchitectureGraph, finding: Finding) => post<{ explanation: Explanation; warning?: string }>("/api/explain", { graph, finding }),
};
