"use client";
import * as React from "react";
import { ShieldCheck, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/oauth";

// `SessionUser` is imported as a TYPE only — TS erases this at compile time,
// so the server-only `lib/oauth` module is never pulled into the client bundle.

interface Props {
  user: SessionUser;
  onSignOut?: () => void;
}

export function ProfileCard({ user, onSignOut }: Props) {
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/github/logout", { method: "POST" });
      onSignOut?.();
    } catch {
      /* ignore */
    } finally {
      // Reload so server-rendered state and other components see logged-out user.
      window.location.reload();
    }
  };

  const display = user.name ?? user.login;

  return (
    <div className="relative rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm">
      <Button
        size="icon"
        variant="ghost"
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-foreground"
      >
        {signingOut ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
      </Button>

      <div className="flex items-start gap-3">
        <img
          src={user.avatar_url}
          alt=""
          className="h-12 w-12 shrink-0 rounded-full ring-1 ring-border"
        />
        <div className="min-w-0 flex-1 pr-6">
          <p className="truncate text-sm font-semibold tracking-tight">
            {display}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            @{user.login}
          </p>
          <p className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-300/90">
            <ShieldCheck className="h-3 w-3" />
            Signed in with GitHub
          </p>
        </div>
      </div>
    </div>
  );
}
