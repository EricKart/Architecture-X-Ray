import { NextResponse } from "next/server";
import { parseGraph } from "@/engine/graph/schema";
import { analyzeArchitecture } from "@/engine/analysis";

/** POST /api/analyze { graph } -> AnalysisReport. Runs every destruction pass. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseGraph((body as { graph?: unknown })?.graph);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid architecture graph.", details: parsed.errors }, { status: 422 });
  try {
    return NextResponse.json({ report: analyzeArchitecture(parsed.graph) });
  } catch (err) {
    console.error("analyze failed", err);
    return NextResponse.json({ error: "Analysis failed.", details: [(err as Error).message] }, { status: 500 });
  }
}
