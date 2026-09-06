import { NextResponse } from "next/server";
import { inferRequirements, DEFAULT_REQUIREMENTS, type Requirements } from "@/engine/architect/requirements";

/** POST /api/architect/infer { brief, base? } -> { requirements, inferred }. */
export async function POST(req: Request) {
  let body: { brief?: string; base?: Requirements };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const brief = (body.brief ?? "").trim();
  if (brief.length < 10) return NextResponse.json({ error: "Describe the system in at least a sentence." }, { status: 400 });
  return NextResponse.json(inferRequirements(brief, body.base ?? DEFAULT_REQUIREMENTS));
}
