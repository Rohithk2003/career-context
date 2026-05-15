"use client";
import * as React from "react";
import Link from "next/link";
import {
	ArrowLeft,
	FileText,
	Github,
	Star,
	GitFork,
	Users,
	ChevronDown,
	ChevronRight,
	Clock,
	Cpu,
	History,
	Inbox,
	CheckCircle2,
	XCircle,
	Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SiteHeader } from "@/components/site-header";
import { Markdown } from "@/components/markdown";
import { cn, formatBytes } from "@/lib/utils";
import type {
	GitHubProfileAggregate,
	ParsedResume,
} from "@/lib/types";
import type { RunKind, RunRecord } from "@/lib/runs-log";

// Mirror the shape returned by /api/runs (RunRecord + id + timestamp).
type PersistedRun = RunRecord & { id: string; timestamp: string };

interface ResumeCacheEntry {
	version: number;
	parsed: ParsedResume;
	savedAt: number;
}

interface GithubCacheEntry {
	data: GitHubProfileAggregate;
	fetchedAt: number;
}

const RESUME_CACHE_KEY = "resume-cache";
const RESUME_CACHE_VERSION = 1;
const GITHUB_CACHE_PREFIX = "gh-cache:";

const OUTPUT_PREVIEW_BYTES = 3 * 1024;

const RUN_KINDS: { value: RunKind; label: string }[] = [
	{ value: "profile", label: "Profile" },
	{ value: "cover-letter", label: "Cover letter" },
	{ value: "cover-letter-latex", label: "Cover letter (LaTeX)" },
	{ value: "tuned-resume", label: "Tuned resume" },
	{ value: "tuned-resume-latex", label: "Tuned resume (LaTeX)" },
	{ value: "resume-latex", label: "Resume (LaTeX)" },
];

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

function formatTimestamp(iso: string): string {
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString();
	} catch {
		return iso;
	}
}

function formatDurationMs(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function loadResumeCache(): ResumeCacheEntry | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(RESUME_CACHE_KEY);
		if (!raw) return null;
		const entry = JSON.parse(raw) as ResumeCacheEntry;
		if (entry?.version !== RESUME_CACHE_VERSION) return null;
		if (!entry.parsed || typeof entry.savedAt !== "number") return null;
		return entry;
	} catch {
		return null;
	}
}

function loadGithubCaches(): GithubCacheEntry[] {
	if (typeof window === "undefined") return [];
	const out: GithubCacheEntry[] = [];
	try {
		for (let i = 0; i < window.localStorage.length; i++) {
			const key = window.localStorage.key(i);
			if (!key || !key.startsWith(GITHUB_CACHE_PREFIX)) continue;
			const raw = window.localStorage.getItem(key);
			if (!raw) continue;
			try {
				const entry = JSON.parse(raw) as GithubCacheEntry;
				if (entry?.data && typeof entry.fetchedAt === "number") {
					out.push(entry);
				}
			} catch {
				/* skip malformed */
			}
		}
	} catch {
		/* storage disabled */
	}
	out.sort((a, b) => b.fetchedAt - a.fetchedAt);
	return out;
}

function kindLabel(k: RunKind): string {
	return RUN_KINDS.find((x) => x.value === k)?.label ?? k;
}

function kindBadgeVariant(
	k: RunKind,
): "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "muted" {
	switch (k) {
		case "profile":
			return "default";
		case "cover-letter":
		case "cover-letter-latex":
			return "secondary";
		case "tuned-resume":
		case "tuned-resume-latex":
		case "resume-latex":
			return "outline";
		default:
			return "muted";
	}
}

// ---------- Resume card ------------------------------------------------------

function ResumeCard({ parsed, savedAt }: { parsed: ParsedResume; savedAt: number }) {
	return (
		<Card className="overflow-hidden">
			<CardContent className="p-4">
				<div className="flex items-start gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
						<FileText className="h-5 w-5 text-primary" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium">{parsed.fileName}</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{parsed.kind.toUpperCase()} · {formatBytes(parsed.bytes)} ·{" "}
							{parsed.charCount.toLocaleString()} chars
							{parsed.truncated && " · truncated"}
						</p>
						<p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<Clock className="h-3 w-3 shrink-0" />
							Cached {formatAge(savedAt)}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// ---------- GitHub card ------------------------------------------------------

function GithubCard({
	data,
	fetchedAt,
}: {
	data: GitHubProfileAggregate;
	fetchedAt: number;
}) {
	return (
		<Card className="overflow-hidden">
			<CardContent className="p-4">
				<div className="flex items-start gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
						<Github className="h-5 w-5 text-primary" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium">
							{data.name ?? data.username}{" "}
							<span className="text-muted-foreground">@{data.username}</span>
						</p>
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
							{data.activity?.most_starred && (
								<span className="inline-flex items-center gap-1">
									<Star className="h-3 w-3" /> avg {data.activity.avg_stars}{" "}
									stars
								</span>
							)}
						</div>
						{data.top_languages?.length > 0 && (
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
						)}
						{data.pinned_repos?.length > 0 && (
							<div className="mt-3 space-y-1.5">
								<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
									Pinned
								</p>
								<ul className="space-y-1">
									{data.pinned_repos.slice(0, 4).map((r) => (
										<li
											key={r.full_name}
											className="flex items-baseline justify-between gap-2 text-xs"
										>
											<span className="truncate font-medium">{r.name}</span>
											<span className="shrink-0 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
												{r.language && <span>{r.language}</span>}
												<span className="inline-flex items-center gap-0.5">
													<Star className="h-3 w-3" /> {r.stars}
												</span>
											</span>
										</li>
									))}
								</ul>
							</div>
						)}
						<p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<Clock className="h-3 w-3 shrink-0" />
							Cached {formatAge(fetchedAt)}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// ---------- Latest output section -------------------------------------------

function LatestOutput({
	title,
	run,
	defaultOpen,
}: {
	title: string;
	run: PersistedRun | null;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = React.useState(!!defaultOpen);
	const body = run?.output ?? "";
	return (
		<Card>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/20"
				aria-expanded={open}
			>
				<div className="flex min-w-0 items-center gap-3">
					{open ? (
						<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate text-sm font-semibold">{title}</span>
					{run ? (
						<span className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:inline-flex">
							<span className="inline-flex items-center gap-1">
								<Cpu className="h-3 w-3" /> {run.provider}/{run.model}
							</span>
							<span className="inline-flex items-center gap-1">
								<Clock className="h-3 w-3" /> {formatTimestamp(run.timestamp)}
							</span>
						</span>
					) : (
						<span className="text-[11px] text-muted-foreground">No runs yet</span>
					)}
				</div>
			</button>
			{open && (
				<CardContent className="p-4 pt-0">
					{run && body ? (
						<div className="max-h-[600px] overflow-y-auto rounded-lg border border-border/60 bg-card/40 p-4 scrollbar-thin">
							<Markdown source={body} />
						</div>
					) : (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-center text-xs text-muted-foreground">
							{run
								? "Run completed with no output (likely an error)."
								: "No completed run yet. Generate from the home page."}
						</div>
					)}
				</CardContent>
			)}
		</Card>
	);
}

// ---------- Run row ----------------------------------------------------------

function RunRow({ run }: { run: PersistedRun }) {
	const [open, setOpen] = React.useState(false);
	const [showFullOutput, setShowFullOutput] = React.useState(false);
	const isSuccess = !run.error;
	const output = run.output ?? "";
	const truncated = output.length > OUTPUT_PREVIEW_BYTES;
	const visibleOutput =
		showFullOutput || !truncated
			? output
			: output.slice(0, OUTPUT_PREVIEW_BYTES);
	const inputsJson = React.useMemo(() => {
		try {
			return JSON.stringify(run.inputs ?? {}, null, 2);
		} catch {
			return "{}";
		}
	}, [run.inputs]);

	return (
		<div className="border-b border-border/40 last:border-0">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
				aria-expanded={open}
			>
				{open ? (
					<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
				)}
				<span className="w-44 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
					{formatTimestamp(run.timestamp)}
				</span>
				<Badge
					variant={kindBadgeVariant(run.kind)}
					className="shrink-0 normal-case tracking-normal"
				>
					{kindLabel(run.kind)}
				</Badge>
				<span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:inline">
					{run.provider}/{run.model}
				</span>
				<span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
					{formatDurationMs(run.durationMs)}
				</span>
				{isSuccess ? (
					<span
						className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-400"
						title="Success"
					>
						<CheckCircle2 className="h-3.5 w-3.5" />
						<span className="hidden sm:inline">ok</span>
					</span>
				) : (
					<span
						className="inline-flex shrink-0 items-center gap-1 text-[11px] text-red-400"
						title={run.error ?? "Error"}
					>
						<XCircle className="h-3.5 w-3.5" />
						<span className="hidden sm:inline">error</span>
					</span>
				)}
			</button>
			{open && (
				<div className="space-y-3 bg-muted/5 px-4 pb-4 pt-1">
					<div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground sm:hidden">
						<span>{run.provider}/{run.model}</span>
					</div>
					<div>
						<p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
							Inputs
						</p>
						<pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/90 scrollbar-thin">
							{inputsJson}
						</pre>
					</div>
					{run.error && (
						<div>
							<p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
								Error
							</p>
							<div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive-foreground/90">
								{run.error}
							</div>
						</div>
					)}
					{run.usage && Object.keys(run.usage).length > 0 && (
						<div>
							<p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
								Token usage
							</p>
							<div className="flex flex-wrap gap-2 text-[11px]">
								{run.usage.inputTokens !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono">
										<span className="text-muted-foreground">in</span>
										{run.usage.inputTokens.toLocaleString()}
									</span>
								)}
								{run.usage.outputTokens !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono">
										<span className="text-muted-foreground">out</span>
										{run.usage.outputTokens.toLocaleString()}
									</span>
								)}
								{run.usage.cacheReadInputTokens !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono">
										<span className="text-muted-foreground">cache-read</span>
										{run.usage.cacheReadInputTokens.toLocaleString()}
									</span>
								)}
								{run.usage.cacheCreationInputTokens !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono">
										<span className="text-muted-foreground">cache-write</span>
										{run.usage.cacheCreationInputTokens.toLocaleString()}
									</span>
								)}
								{run.usage.costUsd !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 font-mono text-emerald-300/90">
										<span className="text-emerald-200/70">$</span>
										{run.usage.costUsd.toFixed(4)}
									</span>
								)}
								{run.usage.evalDurationMs !== undefined && (
									<span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono">
										<span className="text-muted-foreground">eval</span>
										{(run.usage.evalDurationMs / 1000).toFixed(1)}s
									</span>
								)}
							</div>
						</div>
					)}
					<div>
						<div className="mb-1 flex items-center justify-between gap-2">
							<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
								Output{" "}
								{output && (
									<span className="ml-1 normal-case text-muted-foreground/70">
										({output.length.toLocaleString()} chars)
									</span>
								)}
							</p>
							{truncated && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowFullOutput((v) => !v)}
									className="h-6 px-2 text-[10px]"
								>
									{showFullOutput ? "Show preview" : "Show full"}
								</Button>
							)}
						</div>
						{output ? (
							<pre className="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/90 scrollbar-thin">
								{visibleOutput}
								{truncated && !showFullOutput && "\n…"}
							</pre>
						) : (
							<p className="text-xs text-muted-foreground italic">
								No output recorded.
							</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ---------- Page ------------------------------------------------------------

export default function ProfilePage() {
	const [resumeEntry, setResumeEntry] = React.useState<ResumeCacheEntry | null>(
		null,
	);
	const [githubEntries, setGithubEntries] = React.useState<GithubCacheEntry[]>(
		[],
	);
	const [runs, setRuns] = React.useState<PersistedRun[] | null>(null);
	const [runsError, setRunsError] = React.useState<string | null>(null);
	const [filterKind, setFilterKind] = React.useState<RunKind | "all">("all");
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
		setResumeEntry(loadResumeCache());
		setGithubEntries(loadGithubCaches());
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		fetch("/api/runs", { cache: "no-store" })
			.then(async (r) => {
				if (!r.ok) throw new Error(`Failed (${r.status})`);
				return (await r.json()) as { runs: PersistedRun[] };
			})
			.then((data) => {
				if (cancelled) return;
				setRuns(data.runs ?? []);
			})
			.catch((e) => {
				if (cancelled) return;
				setRunsError(
					e instanceof Error ? e.message : "Failed to load run history",
				);
				setRuns([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const latestByKind = React.useMemo(() => {
		const map = new Map<RunKind, PersistedRun>();
		if (!runs) return map;
		for (const r of runs) {
			// `runs` is already newest-first, so the first hit wins.
			if (r.error) continue;
			if (!map.has(r.kind)) map.set(r.kind, r);
		}
		return map;
	}, [runs]);

	const filteredRuns = React.useMemo(() => {
		if (!runs) return [];
		if (filterKind === "all") return runs;
		return runs.filter((r) => r.kind === filterKind);
	}, [runs, filterKind]);

	const kindCounts = React.useMemo(() => {
		const counts = new Map<RunKind, number>();
		if (!runs) return counts;
		for (const r of runs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
		return counts;
	}, [runs]);

	return (
		<div className="min-h-screen bg-background">
			<SiteHeader />
			<main className="container max-w-5xl py-8">
				{/* Header */}
				<div className="mb-8">
					<Link
						href="/"
						className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						Back to home
					</Link>
					<h1 className="mt-3 text-2xl font-semibold tracking-tight">
						Your profile
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Everything Career Context knows about you — parsed inputs, latest
						generated outputs, and the full LLM run history.
					</p>
				</div>

				{/* Inputs */}
				<section className="mb-10">
					<h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						Inputs
					</h2>
					{!mounted ? (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-center text-xs text-muted-foreground">
							Loading…
						</div>
					) : !resumeEntry && githubEntries.length === 0 ? (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
							<Inbox className="mx-auto mb-2 h-5 w-5 opacity-60" />
							No cached inputs yet. Upload a resume or connect GitHub on the{" "}
							<Link href="/" className="text-primary underline-offset-2 hover:underline">
								home page
							</Link>
							.
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							{resumeEntry && (
								<ResumeCard
									parsed={resumeEntry.parsed}
									savedAt={resumeEntry.savedAt}
								/>
							)}
							{githubEntries.map((e) => (
								<GithubCard
									key={e.data.username}
									data={e.data}
									fetchedAt={e.fetchedAt}
								/>
							))}
						</div>
					)}
				</section>

				{/* Latest outputs */}
				<section className="mb-10">
					<h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						Latest outputs
					</h2>
					<div className="space-y-3">
						<LatestOutput
							title="Career profile"
							run={latestByKind.get("profile") ?? null}
							defaultOpen
						/>
						<LatestOutput
							title="Cover letter"
							run={latestByKind.get("cover-letter") ?? null}
						/>
						<LatestOutput
							title="Tuned resume"
							run={latestByKind.get("tuned-resume") ?? null}
						/>
					</div>
				</section>

				{/* All runs */}
				<section>
					<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
							All LLM runs{" "}
							{runs && (
								<span className="ml-1 normal-case text-muted-foreground/70">
									({runs.length.toLocaleString()})
								</span>
							)}
						</h2>
						<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
							<History className="h-3 w-3" />
							<span>Newest first · capped at 500</span>
						</div>
					</div>

					{/* Filter chips */}
					<div className="mb-3 flex flex-wrap items-center gap-1.5">
						<span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
							<Filter className="h-3 w-3" /> Kind
						</span>
						<FilterChip
							active={filterKind === "all"}
							onClick={() => setFilterKind("all")}
							label="All"
							count={runs?.length ?? 0}
						/>
						{RUN_KINDS.map((k) => {
							const count = kindCounts.get(k.value) ?? 0;
							if (count === 0) return null;
							return (
								<FilterChip
									key={k.value}
									active={filterKind === k.value}
									onClick={() => setFilterKind(k.value)}
									label={k.label}
									count={count}
								/>
							);
						})}
					</div>

					{runsError ? (
						<div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive-foreground/90">
							{runsError}
						</div>
					) : runs === null ? (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
							Loading run history…
						</div>
					) : runs.length === 0 ? (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
							<Inbox className="mx-auto mb-2 h-5 w-5 opacity-60" />
							No runs logged yet. Generate something from the{" "}
							<Link href="/" className="text-primary underline-offset-2 hover:underline">
								home page
							</Link>{" "}
							to populate this list.
						</div>
					) : filteredRuns.length === 0 ? (
						<div className="rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
							No runs match this filter.
						</div>
					) : (
						<Card className="overflow-hidden">
							<div className="divide-y divide-border/40">
								{filteredRuns.map((r) => (
									<RunRow key={r.id} run={r} />
								))}
							</div>
						</Card>
					)}
				</section>

				<Separator className="mt-12" />
				<p className="mt-6 text-center text-[11px] text-muted-foreground">
					Cached locally in your browser · Run log persisted to{" "}
					<code className="font-mono">.runs/runs.jsonl</code>
				</p>
			</main>
		</div>
	);
}

function FilterChip({
	active,
	onClick,
	label,
	count,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	count: number;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
				active
					? "border-primary/40 bg-primary/15 text-foreground"
					: "border-border/60 bg-muted/10 text-muted-foreground hover:border-border hover:text-foreground",
			)}
		>
			{label}
			<span className="font-mono text-[10px] text-muted-foreground/80">
				{count}
			</span>
		</button>
	);
}
