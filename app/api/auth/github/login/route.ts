import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  OAUTH_STATE_COOKIE,
  buildAuthorizeUrl,
  createState,
  getCallbackUrl,
  isOAuthConfigured,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local.",
      },
      { status: 503 },
    );
  }
  const state = createState();
  cookies().set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  const url = buildAuthorizeUrl({
    clientId: process.env.GITHUB_CLIENT_ID!,
    redirectUri: getCallbackUrl(req),
    state,
  });
  return NextResponse.redirect(url);
}
