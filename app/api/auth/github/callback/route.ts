import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  OAUTH_STATE_COOKIE,
  exchangeCodeForToken,
  fetchAuthedUser,
  getCallbackUrl,
  isOAuthConfigured,
  setSessionCookies,
} from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ghError = url.searchParams.get("error");

  const home = new URL("/", url.origin);

  if (ghError) {
    home.searchParams.set("auth_error", ghError);
    return NextResponse.redirect(home);
  }
  if (!isOAuthConfigured()) {
    home.searchParams.set("auth_error", "not_configured");
    return NextResponse.redirect(home);
  }
  if (!code || !state) {
    home.searchParams.set("auth_error", "missing_code_or_state");
    return NextResponse.redirect(home);
  }

  const cookieStore = cookies();
  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  if (!expectedState || expectedState !== state) {
    home.searchParams.set("auth_error", "state_mismatch");
    return NextResponse.redirect(home);
  }
  cookieStore.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

  try {
    const { access_token } = await exchangeCodeForToken({
      code,
      redirectUri: getCallbackUrl(req),
    });
    const user = await fetchAuthedUser(access_token);
    setSessionCookies(access_token, user);
    home.searchParams.set("signed_in", "1");
    return NextResponse.redirect(home);
  } catch (err) {
    home.searchParams.set(
      "auth_error",
      err instanceof Error ? err.message : "token_exchange_failed",
    );
    return NextResponse.redirect(home);
  }
}
