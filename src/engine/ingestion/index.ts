import type { ArchitectureGraph } from "../graph/types";
import { parseGraph } from "../graph/schema";
import { extractFromDescription } from "./description";

/**
 * Ingestion registry. Each source kind turns raw input into an
 * ArchitectureGraph. AI-backed extraction is injected so the engine package
 * stays free of SDK dependencies. Future inputs (Terraform, Kubernetes
 * manifests, cloud exports) plug in as additional kinds.
 */
export type IngestKind = "structured" | "description" | "image";

export interface IngestInput {
  kind: IngestKind;
  text?: string;
  json?: unknown;
  image?: { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };
  preferAi?: boolean;
}

export interface IngestResult {
  graph: ArchitectureGraph;
  method: "structured" | "heuristic" | "ai";
  warnings: string[];
}

export interface AiExtractor {
  available: () => boolean;
  extract: (input: { text?: string; image?: IngestInput["image"] }) => Promise<{ graph: ArchitectureGraph }>;
}

export async function ingest(input: IngestInput, ai?: AiExtractor): Promise<IngestResult> {
  if (input.kind === "structured") {
    const parsed = parseGraph(input.json);
    if (!parsed.ok) throw new IngestError("Structured graph is invalid.", parsed.errors);
    return { graph: parsed.graph, method: "structured", warnings: [] };
  }
  if (input.kind === "description") {
    const text = (input.text ?? "").trim();
    if (text.length < 20) throw new IngestError("Description is too short to extract an architecture from.");
    if (ai?.available() && input.preferAi !== false) {
      try {
        const { graph } = await ai.extract({ text });
        return finalize(graph, "ai", []);
      } catch (err) {
        const fallback = extractFromDescription(text);
        return finalize(fallback.graph, "heuristic", [`AI extraction failed (${(err as Error).message}); used the heuristic extractor instead.`, ...fallback.warnings]);
      }
    }
    const r = extractFromDescription(text);
    return finalize(r.graph, "heuristic", [...r.warnings, ...(ai?.available() ? [] : ["No AI key configured: relationships were inferred heuristically. Set ANTHROPIC_API_KEY for model-based extraction."])]);
  }
  if (!input.image) throw new IngestError("No image supplied.");
  if (!ai?.available()) throw new IngestError("Diagram ingestion needs the AI layer. Set ANTHROPIC_API_KEY in .env.local and restart.");
  const { graph } = await ai.extract({ image: input.image, text: input.text });
  return finalize(graph, "ai", []);
}

function finalize(graph: ArchitectureGraph, method: IngestResult["method"], warnings: string[]): IngestResult {
  const check = parseGraph(graph);
  if (!check.ok) throw new IngestError("Extracted graph failed validation.", check.errors);
  return { graph: check.graph, method, warnings };
}

export class IngestError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.details = details;
  }
}
