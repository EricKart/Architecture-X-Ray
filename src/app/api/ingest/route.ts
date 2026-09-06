import { NextResponse } from "next/server";
import { ingest, IngestError, type IngestInput } from "@/engine/ingestion";
import { aiAvailable, extractGraphWithAi } from "@/ai/anthropic";

export const maxDuration = 120;

/** POST /api/ingest { kind, text?, json?, image? } -> { graph, method, warnings }. */
export async function POST(req: Request) {
  let body: IngestInput;
  try {
    body = (await req.json()) as IngestInput;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!["structured", "description", "image"].includes(body?.kind)) return NextResponse.json({ error: "kind must be structured, description or image." }, { status: 400 });
  if (body.image && body.image.base64.length > 8_000_000) return NextResponse.json({ error: "Image too large (max ~6 MB)." }, { status: 413 });
  try {
    const result = await ingest(body, { available: aiAvailable, extract: (i) => extractGraphWithAi(i) });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IngestError) return NextResponse.json({ error: err.message, details: err.details }, { status: 422 });
    console.error("ingest failed", err);
    return NextResponse.json({ error: "Ingestion failed.", details: [(err as Error).message] }, { status: 500 });
  }
}
