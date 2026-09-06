import { NextResponse } from "next/server";
import { buildDemoGraph } from "@/engine/demo/ai-saas-demo";

export const dynamic = "force-dynamic";

/** GET /api/demo - the built-in demonstration architecture. */
export function GET() {
  return NextResponse.json({ graph: buildDemoGraph() });
}
