import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, ai: Boolean(process.env.ANTHROPIC_API_KEY), version: process.env.npm_package_version ?? "0.1.0" });
}
