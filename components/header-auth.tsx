"use client";
import * as React from "react";
import { Github, LogOut, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/oauth";

// `SessionUser` is imported as a TYPE only — TS erases this at compile time,
// so the server-only `lib/oauth` module is never pulled into the client bundle.

interface AuthState {
  configured: boolean;
  user: SessionUser | null;
}

export function HeaderAuth() {
  const [auth, setAuth] = React.useState<AuthState | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    // Strip OAuth callback query params (?signed_in=1 or ?auth_error=...).
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("signed_in") || params.has("auth_error")) {
        params.delete("signed_in");
        params.delete("auth_error");
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : "") +
          window.location.hash;
        window.history.replaceState({}, "", next);
      }
    } catch {
      /* ignore */
    }

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as AuthState;
        if (!cancelled) setAuth(data);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = () => {
    window.location.href = "/api/auth/github/login";
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/github/logout", { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      window.location.reload();
    }
  };

  // Initial load — render a neutral placeholder to avoid layout flash.
  if (!auth) {
    return (
      <div
        className="h-8 w-24 animate-pulse rounded-md bg-muted/40"
        aria-hidden
      />
    );
  }

  // OAuth not configured — tiny muted chip.
  if (!auth.configured) {
    return (
      <a
        href="https://github.com/your-org/career-context-ai#github-oauth"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        title="Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env.local"
      >
        <ShieldAlert className="h-3 w-3" />
        Configure GitHub OAuth
      </a>
    );
  }

  // Signed in.
  if (auth.user) {
    const display = auth.user.name ?? auth.user.login;
    return (
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/40 py-1 pl-1 pr-1.5 backdrop-blur-sm">
        <img
          src={auth.user.avatar_url}
          alt=""
          className="h-6 w-6 rounded-full ring-1 ring-border"
        />
        <div className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="max-w-[120px] truncate text-xs font-medium">
            {display}
          </span>
          <span className="max-w-[120px] truncate text-[10px] text-muted-foreground">
            @{auth.user.login}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          {signingOut ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    );
  }

  // Configured + signed out — primary CTA.
  return (
    <Button size="sm" onClick={handleSignIn} className="h-8">
      <Github className="h-3.5 w-3.5" />
      Sign in with GitHub
    </Button>
  );
}
