import { NextResponse } from "next/server";
import { buildArchitecture } from "@/engine/architect";
import type { Requirements } from "@/engine/architect/requirements";
import { parseGraph } from "@/engine/graph/schema";

/** POST /api/architect/generate { requirements } -> { package }. */
export async function POST(req: Request) {
  let body: { requirements?: Requirements };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const r = body.requirements;
  if (!r || !r.business || !r.traffic || !r.reliability || !r.provider) return NextResponse.json({ error: "Incomplete requirements." }, { status: 400 });
  try {
    const pkg = buildArchitecture(r);
    const check = parseGraph(pkg.graph);
    if (!check.ok) return NextResponse.json({ error: "Generated graph failed validation.", details: check.errors }, { status: 500 });
    return NextResponse.json({ package: pkg });
  } catch (err) {
    console.error("generate failed", err);
    return NextResponse.json({ error: "Generation failed.", details: [(err as Error).message] }, { status: 500 });
  }
}
