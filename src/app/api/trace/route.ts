import { NextResponse } from "next/server";
import { parseGraph } from "@/engine/graph/schema";
import { traceFlow } from "@/engine/simulation/trace";

/** POST /api/trace { graph, flowId } -> RequestTrace. */
export async function POST(req: Request) {
  let body: { graph?: unknown; flowId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseGraph(body.graph);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid architecture graph.", details: parsed.errors }, { status: 422 });
  if (!body.flowId || !parsed.graph.flows.some((f) => f.id === body.flowId)) return NextResponse.json({ error: "Unknown flow." }, { status: 400 });
  return NextResponse.json({ trace: traceFlow(parsed.graph, body.flowId) });
}
