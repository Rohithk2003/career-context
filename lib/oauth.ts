import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const OAUTH_COOKIE = "gh_token";
export const OAUTH_STATE_COOKIE = "gh_oauth_state";
export const OAUTH_USER_COOKIE = "gh_user";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function isOAuthConfigured(): boolean {
  return (
    !!process.env.GITHUB_CLIENT_ID?.trim() &&
    !!process.env.GITHUB_CLIENT_SECRET?.trim()
  );
}

export function getCallbackUrl(req: Request): string {
  const explicit = process.env.GITHUB_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const url = new URL(req.url);
  return `${url.origin}/api/auth/github/callback`;
}

export function createState(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", "read:user repo");
  u.searchParams.set("state", args.state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

export async function exchangeCodeForToken(args: {
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; token_type: string; scope: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Token exchange returned no token");
  }
  return {
    access_token: data.access_token,
    token_type: data.token_type ?? "bearer",
    scope: data.scope ?? "",
  };
}

export interface SessionUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export async function fetchAuthedUser(token: string): Promise<SessionUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "career-context-ai",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch /user (${res.status})`);
  }
  const data = (await res.json()) as {
    login: string;
    name: string | null;
    avatar_url: string;
  };
  return {
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
  };
}

export function setSessionCookies(token: string, user: SessionUser) {
  const c = cookies();
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  };
  c.set(OAUTH_COOKIE, token, common);
  // user cookie is readable by the client so the UI can show avatar/login
  c.set(OAUTH_USER_COOKIE, JSON.stringify(user), {
    ...common,
    httpOnly: false,
  });
}

export function clearSessionCookies() {
  const c = cookies();
  c.set(OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  c.set(OAUTH_USER_COOKIE, "", { path: "/", maxAge: 0 });
}

export function getServerToken(): string | null {
  return cookies().get(OAUTH_COOKIE)?.value || null;
}

export function getServerUser(): SessionUser | null {
  const raw = cookies().get(OAUTH_USER_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}
