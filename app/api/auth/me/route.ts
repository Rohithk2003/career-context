import { NextResponse } from "next/server";
import { getServerUser, isOAuthConfigured } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    configured: isOAuthConfigured(),
    user: getServerUser(),
  });
}
