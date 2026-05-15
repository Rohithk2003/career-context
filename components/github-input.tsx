"use client";
import * as React from "react";
import {
  Github,
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
  Star,
  GitFork,
  Users,
  LogOut,
  ShieldCheck,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { GitHubProfileAggregate } from "@/lib/types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  data: GitHubProfileAggregate | null;
  onData: (d: GitHubProfileAggregate | null) => void;
}

interface AuthState {
  configured: boolean;
  user: { login: string; name: string | null; avatar_url: string } | null;
}

// --- localStorage cache ------------------------------------------------------
// Keep the analyzed profile around across reloads so the user doesn't burn
// GitHub rate limits and waiting time every visit. Keyed by lowercase login.
const CACHE_PREFIX = "gh-cache:";

interface CacheEntry {
  data: GitHubProfileAggregate;
  fetchedAt: number;
}

function cacheKey(login: string): string {
  return `${CACHE_PREFIX}${login.toLowerCase()}`;
}

function loadCache(login: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(login));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.data || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(login: string, data: GitHubProfileAggregate): number {
  if (typeof window === "undefined") return 0;
  const fetchedAt = Date.now();
  try {
    window.localStorage.setItem(
      cacheKey(login),
      JSON.stringify({ data, fetchedAt } satisfies CacheEntry),
    );
  } catch {
    /* quota exceeded or other — silent */
  }
  return fetchedAt;
}

function clearCache(login: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cacheKey(login));
  } catch {
    /* ignore */
  }
}

function formatAge(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function GithubInput({ value, onChange, data, onData }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [auth, setAuth] = React.useState<AuthState | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState<number | null>(null);
  const [fromCache, setFromCache] = React.useState(false);

  const loadAuth = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;
      setAuth((await res.json()) as AuthState);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    loadAuth();
    // Pick up ?signed_in=1 / ?auth_error= on return from the OAuth callback.
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) setError(`GitHub sign-in failed: ${err}`);
    if (params.get("signed_in") || params.get("auth_error")) {
      params.delete("signed_in");
      params.delete("auth_error");
      const next =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, "", next);
    }
  }, [loadAuth]);

  // On mount (and when auth resolves), try to restore the most recent cached
  // profile for the signed-in user. This avoids re-hitting the GitHub API on
  // every reload and gives the user control over when to refresh.
  React.useEffect(() => {
    if (data) return; // parent already has data
    const login = auth?.user?.login;
    if (!login) return;
    const cached = loadCache(login);
    if (cached) {
      onData(cached.data);
      setFetchedAt(cached.fetchedAt);
      setFromCache(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.user?.login]);

  const handleFetch = React.useCallback(
    async (handle?: string) => {
      setError(null);
      const h = handle ?? value;
      if (!h.trim() && !auth?.user) {
        setError("Enter a username or sign in with GitHub.");
        return;
      }
      setLoading(true);
      try {
        const res = await fetch("/api/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: h }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);
        const profile = json as GitHubProfileAggregate;
        onData(profile);
        const savedAt = saveCache(profile.username, profile);
        setFetchedAt(savedAt);
        setFromCache(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch profile");
      } finally {
        setLoading(false);
      }
    },
    [value, onData, auth],
  );

  const handleSignIn = () => {
    window.location.href = "/api/auth/github/login";
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/github/logout", { method: "POST" });
    setAuth({ configured: auth?.configured ?? false, user: null });
    onData(null);
    setFetchedAt(null);
    setFromCache(false);
  };

  const handleClearData = () => {
    if (data) clearCache(data.username);
    onData(null);
    setFetchedAt(null);
    setFromCache(false);
  };

  // ---------- Signed-in state ----------
  if (auth?.user && !data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <img
            src={auth.user.avatar_url}
            alt=""
            className="h-9 w-9 rounded-full ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {auth.user.name ?? auth.user.login}{" "}
              <span className="text-muted-foreground">@{auth.user.login}</span>
            </p>
            <p className="flex items-center gap-1 text-[11px] text-emerald-300/90">
              <ShieldCheck className="h-3 w-3" /> Signed in with GitHub
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <Button
          onClick={() => handleFetch("")}
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching your profile…
            </>
          ) : (
            <>
              <Github className="h-4 w-4" /> Analyze my GitHub profile
            </>
          )}
        </Button>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            or another user
          </span>
          <Separator className="flex-1" />
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Github className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="username or https://github.com/username"
              className="pl-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleFetch();
                }
              }}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => handleFetch()}
            disabled={loading || !value.trim()}
            className="shrink-0"
          >
            Fetch
          </Button>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            {error}
          </div>
        )}
      </div>
    );
  }

  // ---------- Profile-fetched state ----------
  if (data) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-border/80 bg-card/60 p-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
              <Github className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {data.name ?? data.username}{" "}
                  <span className="text-muted-foreground">
                    @{data.username}
                  </span>
                </p>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              </div>
              {data.bio && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {data.bio}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> {data.followers} followers
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> {data.public_repos} repos
                </span>
                {data.activity.most_starred && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3" /> avg {data.activity.avg_stars}{" "}
                    stars
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.top_languages.slice(0, 6).map((l) => (
                  <Badge
                    key={l.language}
                    variant="muted"
                    className="normal-case tracking-normal"
                  >
                    {l.language}{" "}
                    <span className="ml-1 text-muted-foreground/70">
                      ·{l.repos}
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={handleClearData}
              aria-label="Clear GitHub data"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {fetchedAt && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {fromCache ? "Cached" : "Analyzed"} {formatAge(fetchedAt)}
                {fromCache && " · Refresh to re-pull from GitHub"}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                handleFetch(auth?.user?.login === data.username ? "" : data.username)
              }
              disabled={loading}
              className="h-7 shrink-0 px-2 text-[11px]"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Refreshing…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---------- Default (no auth, no data) ----------
  return (
    <div className="space-y-3">
      {auth?.configured && (
        <Button onClick={handleSignIn} className="w-full" variant="outline">
          <Github className="h-4 w-4" /> Sign in with GitHub
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        GitHub is fully optional. The profile, cover letter, and résumé tune
        all work without it — it just adds extra evidence when present.
      </p>
      {auth?.configured && (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            or paste a username
          </span>
          <Separator className="flex-1" />
        </div>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Github className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="username or https://github.com/username"
            className="pl-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleFetch();
              }
            }}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => handleFetch()}
          disabled={loading || !value.trim()}
          className="shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
        </Button>
      </div>

      {auth && !auth.configured && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="inline-flex items-center gap-1 text-foreground/80">
            <ShieldCheck className="h-3 w-3" /> Enable OAuth
          </span>{" "}
          by adding{" "}
          <code className="font-mono">GITHUB_CLIENT_ID</code> +{" "}
          <code className="font-mono">GITHUB_CLIENT_SECRET</code> to{" "}
          <code className="font-mono">.env.local</code>. See README.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          {error}
        </div>
      )}
    </div>
  );
}
