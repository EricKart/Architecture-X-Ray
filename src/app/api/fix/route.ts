import { NextResponse } from "next/server";
import { parseGraph } from "@/engine/graph/schema";
import { applyPatch } from "@/engine/graph/patch";
import { analyzeArchitecture } from "@/engine/analysis";
import type { GraphPatch } from "@/engine/analysis/types";

/** POST /api/fix { graph, patch } -> { graph, report }. Applies a finding's fix and re-analyses. */
export async function POST(req: Request) {
  let body: { graph?: unknown; patch?: GraphPatch };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseGraph(body.graph);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid architecture graph.", details: parsed.errors }, { status: 422 });
  if (!body.patch || typeof body.patch.description !== "string") return NextResponse.json({ error: "Missing patch." }, { status: 400 });
  const graph = applyPatch(parsed.graph, body.patch);
  const check = parseGraph(graph);
  if (!check.ok) return NextResponse.json({ error: "Patch produced an invalid graph.", details: check.errors }, { status: 422 });
  return NextResponse.json({ graph: check.graph, report: analyzeArchitecture(check.graph) });
}
