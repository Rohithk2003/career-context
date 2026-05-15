import { NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  clearSessionCookies();
  return NextResponse.json({ ok: true });
}
