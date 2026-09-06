import { NextResponse } from "next/server";
import { parseGraph } from "@/engine/graph/schema";
import { simulateFailure, type FailureScenario } from "@/engine/simulation/failure";

const KINDS = new Set(["component", "availability_zone", "region", "dns", "certificate", "network_egress", "identity_provider", "ai_provider"]);

/** POST /api/simulate { graph, scenario } -> FailureResult. */
export async function POST(req: Request) {
  let body: { graph?: unknown; scenario?: FailureScenario };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parseGraph(body.graph);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid architecture graph.", details: parsed.errors }, { status: 422 });
  const scenario = body.scenario;
  if (!scenario || !KINDS.has(scenario.kind)) return NextResponse.json({ error: "Unknown scenario kind." }, { status: 400 });
  if (scenario.kind === "component" && !parsed.graph.components.some((c) => c.id === scenario.targetId))
    return NextResponse.json({ error: "Unknown component." }, { status: 400 });
  try {
    return NextResponse.json({ result: simulateFailure(parsed.graph, scenario) });
  } catch (err) {
    return NextResponse.json({ error: "Simulation failed.", details: [(err as Error).message] }, { status: 500 });
  }
}
