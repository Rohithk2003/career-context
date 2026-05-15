import "server-only";
import { getServerToken } from "./oauth";
import type { GitHubProfileAggregate, GitHubRepoSummary } from "./types";

const GITHUB_API = "https://api.github.com";

function ghHeaders(authToken?: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "career-context-ai",
  };
  const token = authToken ?? process.env.GITHUB_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function extractGitHubUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Handle "@username", bare username, or URLs
  const at = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  try {
    const url = new URL(at.includes("://") ? at : `https://${at}`);
    if (url.hostname.endsWith("github.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 1) return cleanUsername(parts[0]);
    }
  } catch {
    /* not a URL */
  }
  if (/^[A-Za-z0-9-]{1,39}$/.test(at)) return at;
  return null;
}

function cleanUsername(u: string): string | null {
  if (/^[A-Za-z0-9-]{1,39}$/.test(u)) return u;
  return null;
}

async function ghFetch<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T | null> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...ghHeaders(init?.token), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `GitHub ${path} returned ${res.status}: ${(await res.text()).slice(0, 240)}`,
    );
  }
  return (await res.json()) as T;
}

async function fetchAuthedLogin(token: string): Promise<string | null> {
  try {
    const user = await ghFetch<{ login: string }>(`/user`, { token });
    return user?.login ?? null;
  } catch {
    return null;
  }
}

interface UserResponse {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
}

interface RepoResponse {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  html_url: string;
}

async function fetchAllRepos(
  username: string,
  token: string | null,
  isSelf: boolean,
  maxPages = 4,
): Promise<RepoResponse[]> {
  // For the authenticated user, /user/repos returns more (incl. private if scope allows)
  const all: RepoResponse[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const path = isSelf && token
      ? `/user/repos?per_page=100&sort=pushed&affiliation=owner&page=${page}`
      : `/users/${username}/repos?per_page=100&sort=pushed&page=${page}`;
    const data = await ghFetch<RepoResponse[]>(path, { token });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
  }
  return all;
}

async function fetchProfileReadme(
  username: string,
  token: string | null,
): Promise<string | null> {
  // Try the dedicated "username/username" repo's README.
  const data = await ghFetch<{ content: string; encoding: string }>(
    `/repos/${username}/${username}/readme`,
    { token },
  );
  if (!data) return null;
  if (data.encoding !== "base64") return null;
  try {
    return Buffer.from(data.content, "base64")
      .toString("utf-8")
      .slice(0, 6_000);
  } catch {
    return null;
  }
}

async function fetchPinnedRepos(username: string): Promise<string[]> {
  // Pinned repos are not in the REST API. We fetch the public profile HTML
  // and look for the pinned-item slugs in markup. Falls back silently.
  try {
    const res = await fetch(`https://github.com/${username}`, {
      headers: { "User-Agent": "career-context-ai" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const slugs = new Set<string>();
    const re = /\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)"[^>]*data-view-component="true"[^>]*class="[^"]*Link[^"]*"/g;
    // Simpler approach: extract pinned repos via the pinned section pattern.
    const pinRe = new RegExp(
      `href="/${username}/([A-Za-z0-9_.-]+)"[^>]*data-view-component="true"[^>]*class="[^"]*Link text-bold[^"]*"`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = pinRe.exec(html)) !== null) {
      slugs.add(m[1]);
      if (slugs.size >= 6) break;
    }
    // unused alias guard
    void re;
    return Array.from(slugs);
  } catch {
    return [];
  }
}

function toRepoSummary(
  r: RepoResponse,
  pinned: Set<string>,
): GitHubRepoSummary {
  return {
    name: r.name,
    full_name: r.full_name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    pushed_at: r.pushed_at,
    topics: r.topics ?? [],
    archived: r.archived,
    fork: r.fork,
    is_pinned: pinned.has(r.name),
    url: r.html_url,
  };
}

export async function aggregateGitHub(
  rawInput: string,
): Promise<GitHubProfileAggregate> {
  const sessionToken = getServerToken();

  let username: string | null = null;
  if (rawInput && rawInput.trim()) {
    username = extractGitHubUsername(rawInput);
    if (!username)
      throw new Error("That doesn't look like a GitHub username or URL.");
  } else if (sessionToken) {
    username = await fetchAuthedLogin(sessionToken);
  }
  if (!username) {
    throw new Error("Provide a GitHub username or sign in with GitHub.");
  }

  const authedLogin = sessionToken ? await fetchAuthedLogin(sessionToken) : null;
  const isSelf = !!authedLogin && authedLogin.toLowerCase() === username.toLowerCase();

  const user = await ghFetch<UserResponse>(`/users/${username}`, {
    token: sessionToken,
  });
  if (!user) throw new Error(`GitHub user "${username}" not found.`);

  const [repos, readme, pinnedSlugs] = await Promise.all([
    fetchAllRepos(username, sessionToken, isSelf),
    fetchProfileReadme(username, sessionToken).catch(() => null),
    fetchPinnedRepos(username).catch(() => []),
  ]);
  const pinned = new Set(pinnedSlugs);

  // Top languages by repo count (no per-repo byte-count call to avoid rate limits)
  const langMap = new Map<
    string,
    { language: string; bytes: number; repos: number }
  >();
  for (const r of repos) {
    if (r.fork || r.archived || !r.language) continue;
    const cur = langMap.get(r.language) ?? {
      language: r.language,
      bytes: 0,
      repos: 0,
    };
    cur.repos += 1;
    // crude weight: stars + 1
    cur.bytes += r.stargazers_count + 1;
    langMap.set(r.language, cur);
  }
  const top_languages = Array.from(langMap.values())
    .sort((a, b) => b.repos - a.repos || b.bytes - a.bytes)
    .slice(0, 12);

  // Topics aggregated across non-fork repos
  const topicCounts = new Map<string, number>();
  for (const r of repos) {
    if (r.fork) continue;
    for (const t of r.topics ?? []) {
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    }
  }
  const topics = Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([t]) => t);

  // Pinned + recent + most-starred
  const ownedRepos = repos.filter((r) => !r.fork);
  const pinned_repos: GitHubRepoSummary[] = ownedRepos
    .filter((r) => pinned.has(r.name))
    .slice(0, 6)
    .map((r) => toRepoSummary(r, pinned));
  // Fallback: if no pinned scrape, surface most-starred owned repos
  const pinnedFallback: GitHubRepoSummary[] =
    pinned_repos.length === 0
      ? [...ownedRepos]
          .sort((a, b) => b.stargazers_count - a.stargazers_count)
          .slice(0, 6)
          .map((r) => toRepoSummary(r, pinned))
      : pinned_repos;

  const recent_repos: GitHubRepoSummary[] = [...ownedRepos]
    .sort((a, b) => {
      const ad = a.pushed_at ? Date.parse(a.pushed_at) : 0;
      const bd = b.pushed_at ? Date.parse(b.pushed_at) : 0;
      return bd - ad;
    })
    .slice(0, 10)
    .map((r) => toRepoSummary(r, pinned));

  const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const repos_pushed_last_year = ownedRepos.filter(
    (r) => r.pushed_at && Date.parse(r.pushed_at) >= yearAgo,
  ).length;
  const total_stars = ownedRepos.reduce(
    (s, r) => s + r.stargazers_count,
    0,
  );
  const avg_stars = ownedRepos.length
    ? +(total_stars / ownedRepos.length).toFixed(1)
    : 0;
  const most_starred =
    ownedRepos.length === 0
      ? null
      : toRepoSummary(
          [...ownedRepos].sort(
            (a, b) => b.stargazers_count - a.stargazers_count,
          )[0],
          pinned,
        );

  return {
    username: user.login,
    name: user.name,
    bio: user.bio,
    company: user.company,
    location: user.location,
    blog: user.blog,
    followers: user.followers,
    following: user.following,
    public_repos: user.public_repos,
    created_at: user.created_at,
    profile_readme: readme,
    top_languages,
    topics,
    recent_repos,
    pinned_repos: pinnedFallback,
    activity: {
      // estimate from pushed-last-year repos (cheap heuristic without /events spam)
      total_commits_estimate: repos_pushed_last_year * 25,
      repos_pushed_last_year,
      avg_stars,
      most_starred,
    },
  };
}
