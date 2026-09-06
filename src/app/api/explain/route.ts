import { NextResponse } from "next/server";
import { parseGraph } from "@/engine/graph/schema";
import { explainFinding } from "@/engine/teaching/explain";
import { aiAvailable, explainWithAi } from "@/ai/anthropic";
import type { Finding } from "@/engine/analysis/types";

export const maxDuration = 60;

/** POST /api/explain { graph, finding } -> { explanation } (template, AI-enriched when a key is configured). */
export async function POST(req: Request) {
  let body: { graph?: unknown; finding?: Finding };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseGraph(body.graph);
  if (!parsed.ok || !body.finding) return NextResponse.json({ error: "Invalid graph or finding." }, { status: 422 });
  const base = explainFinding(body.finding, parsed.graph);
  if (!aiAvailable()) return NextResponse.json({ explanation: base });
  try {
    const summary = `${parsed.graph.name}: ${parsed.graph.components.map((c) => `${c.name} (${c.type})`).join(", ")}`;
    return NextResponse.json({ explanation: await explainWithAi(body.finding, summary, base) });
  } catch (err) {
    return NextResponse.json({ explanation: base, warning: `AI enrichment failed: ${(err as Error).message}` });
  }
}
