"use client";
import * as React from "react";
import {
  Sparkles,
  Wand2,
  FileText,
  Github,
  Target,
  Cpu,
  Link as LinkIcon,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ResumeDropzone } from "@/components/resume-dropzone";
import { GithubInput } from "@/components/github-input";
import { ModelSelector, type ModelSelectorValue } from "@/components/model-selector";
import { OutputPanel, type StageState } from "@/components/output-panel";
import type { RunUsage } from "@/lib/runs-log";
import { SiteHeader } from "@/components/site-header";
import { ProfileCard } from "@/components/profile-card";
import { LatexOutput } from "@/components/latex-output";
import { CoverLetterOutput } from "@/components/cover-letter-output";
import { TunedResumeOutput } from "@/components/tuned-resume-output";
import { ImproveContext } from "@/components/improve-context";
import { ClaudeCodeSkills } from "@/components/claude-code-skills";
import type {
  GitHubProfileAggregate,
  ParsedResume,
} from "@/lib/types";

interface SessionUserClient {
  login: string;
  name: string | null;
  avatar_url: string;
}

type SseEvent =
  | { type: "stage"; stage: string; status: "start" | "done" }
  | { type: "delta"; text: string }
  | { type: "usage"; usage: RunUsage }
  | { type: "error"; message: string }
  | { type: "done" };

export default function Page() {
  const [model, setModel] = React.useState<ModelSelectorValue | null>(null);
  const [claudeCodeSkills, setClaudeCodeSkills] = React.useState<string[]>([]);
  const [resume, setResume] = React.useState<ParsedResume | null>(null);
  const [githubInput, setGithubInput] = React.useState("");
  const [githubData, setGithubData] = React.useState<GitHubProfileAggregate | null>(
    null,
  );
  const [jobDescription, setJobDescription] = React.useState("");
  const [autoTuneResume, setAutoTuneResume] = React.useState(false);
  // Nonce we bump when we want the TunedResumeOutput to start generating.
  // Increment-only: each new value is a fresh "go" signal. Decoupled from
  // mount timing so React effect cleanups can't kill the trigger.
  const [tuneTriggerNonce, setTuneTriggerNonce] = React.useState(0);
  // Track which generation cycle we've already kicked tune for so we don't
  // re-trigger on every re-render after profile completion.
  const lastTunedForFinishRef = React.useRef<number | null>(null);
  const [scrapingJob, setScrapingJob] = React.useState(false);
  const [scrapeError, setScrapeError] = React.useState<string | null>(null);
  const [scrapedFrom, setScrapedFrom] = React.useState<string | null>(null);
  const [sessionUser, setSessionUser] = React.useState<SessionUserClient | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.user) setSessionUser(d.user as SessionUserClient);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const detectedJobUrl = React.useMemo(() => {
    const trimmed = jobDescription.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    try {
      const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.toString();
    } catch {
      return null;
    }
  }, [jobDescription]);

  const handleScrapeJob = async () => {
    if (!detectedJobUrl) return;
    setScrapingJob(true);
    setScrapeError(null);
    try {
      const res = await fetch("/api/scrape-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: detectedJobUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        content?: string;
        title?: string | null;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.content) {
        throw new Error(data.error || `Scrape failed (${res.status})`);
      }
      const header = data.title ? `# ${data.title}\n\n` : "";
      setJobDescription(`${header}${data.content}`);
      setScrapedFrom(data.url ?? detectedJobUrl);
    } catch (e) {
      setScrapeError(e instanceof Error ? e.message : "Scrape failed");
    } finally {
      setScrapingJob(false);
    }
  };

  const [output, setOutput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [stages, setStages] = React.useState<StageState[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [finishedAt, setFinishedAt] = React.useState<number | null>(null);
  const [usage, setUsage] = React.useState<RunUsage | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);

  const canGenerate =
    !!model && !streaming && (!!resume || !!githubData || !!jobDescription.trim());

  const handleGenerate = async () => {
    if (!model) return;
    setError(null);
    setOutput("");
    setStages([]);
    setUsage(null);
    setStartedAt(Date.now());
    setFinishedAt(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: model.provider,
          model: model.model,
          resumeText: resume?.text ?? null,
          github: githubData,
          jobDescription: jobDescription.trim() || null,
          claudeCodeSkills:
            model.provider === "claude-code" && claudeCodeSkills.length > 0
              ? claudeCodeSkills
              : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res
          .json()
          .catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          const payload = raw.slice(5).trim();
          if (!payload) continue;
          let event: SseEvent;
          try {
            event = JSON.parse(payload) as SseEvent;
          } catch {
            continue;
          }
          if (event.type === "delta") {
            setOutput((prev) => prev + event.text);
          } else if (event.type === "stage") {
            setStages((prev) => {
              if (event.status === "start") {
                if (prev.some((p) => p.label === event.stage)) return prev;
                return [...prev, { label: event.stage, status: "active" }];
              }
              return prev.map((p) =>
                p.label === event.stage ? { ...p, status: "done" } : p,
              );
            });
          } else if (event.type === "usage") {
            setUsage(event.usage);
          } else if (event.type === "error") {
            setError(event.message);
          } else if (event.type === "done") {
            // handled by loop termination
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // user-initiated stop
      } else {
        setError(e instanceof Error ? e.message : "Generation failed");
      }
    } finally {
      setStreaming(false);
      setFinishedAt(Date.now());
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const generationDone = !streaming && !!output && !!finishedAt;
  const showLatexPanel = !!resume?.latexSource && generationDone;
  const showCoverLetterPanel = generationDone && !!jobDescription.trim();
  // Tuned-résumé output appears only when the user opted in via the checkbox
  // AND the profile has finished generating. The checkbox itself fires the
  // tune automatically — there's no manual "Auto-tune resume" button anymore.
  const showTunedResumePanel =
    autoTuneResume && generationDone && !!resume && !!jobDescription.trim();

  // When profile generation finishes AND the user opted in, fire the tune
  // exactly once per generation cycle by bumping the trigger nonce. Keyed on
  // `finishedAt` so a fresh profile run produces a fresh trigger; keyed on
  // the ref so toggling the checkbox after-the-fact doesn't also fire.
  React.useEffect(() => {
    if (!autoTuneResume) return;
    if (!generationDone) return;
    if (!resume) return;
    if (!jobDescription.trim()) return;
    if (finishedAt === null) return;
    if (lastTunedForFinishRef.current === finishedAt) return;
    lastTunedForFinishRef.current = finishedAt;
    // Small delay so the user visibly sees the profile finalize before the
    // tune kicks off — earlier ask: "once aligning completes then only work
    // on auto tuning".
    const t = setTimeout(() => {
      setTuneTriggerNonce((n) => n + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [autoTuneResume, generationDone, resume, jobDescription, finishedAt]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Decorative background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="absolute left-1/2 top-[-20%] h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute right-[-10%] top-[40%] h-[400px] w-[400px] rounded-full bg-fuchsia-500/10 blur-[100px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.04]" />
      </div>

      <SiteHeader />

      <main className="container py-8">
        <section className="mb-8 max-w-2xl">
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            A career profile, built by an AI that runs on{" "}
            <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
              your machine
            </span>
            .
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Upload your resume, point it at your GitHub, paste a target job
            description — and get a structured, recruiter-aware context profile
            you can use for interviews, networking, or positioning. Pick a local
            model for full privacy, or plug in Claude/GPT/Gemini for top-tier
            quality.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
          {/* Left: Inputs */}
          <aside className="space-y-5">
            {sessionUser && (
              <ProfileCard
                user={sessionUser}
                onSignOut={() => setSessionUser(null)}
              />
            )}

            <div className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <Label className="text-[10px]">LLM provider & model</Label>
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Cpu className="h-2.5 w-2.5" />
                  Local · Claude · GPT · Gemini
                </span>
              </div>
              <ModelSelector value={model} onChange={setModel} />
              {model?.provider === "claude-code" && (
                <div className="mt-3 border-t border-border/40 pt-3">
                  <ClaudeCodeSkills
                    value={claudeCodeSkills}
                    onChange={setClaudeCodeSkills}
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <Label className="text-[10px]">Resume</Label>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  PDF · DOCX · .tex
                </span>
              </div>
              <ResumeDropzone
                onParsed={setResume}
                parsed={resume}
                onClear={() => setResume(null)}
              />
            </div>

            <div className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Github className="h-3.5 w-3.5 text-primary" />
                  <Label className="text-[10px]">GitHub Profile</Label>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  optional
                </span>
              </div>
              <GithubInput
                value={githubInput}
                onChange={setGithubInput}
                data={githubData}
                onData={setGithubData}
              />
            </div>

            <div className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-primary" />
                  <Label className="text-[10px]">
                    Target Job Description
                  </Label>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  optional
                </span>
              </div>
              <Textarea
                value={jobDescription}
                onChange={(e) => {
                  setJobDescription(e.target.value);
                  if (scrapedFrom) setScrapedFrom(null);
                  if (scrapeError) setScrapeError(null);
                }}
                placeholder="Paste the JD — or just a job posting URL and we'll scrape it via Firecrawl."
                rows={6}
                className="min-h-[140px]"
              />
              {detectedJobUrl && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <LinkIcon className="h-3 w-3 shrink-0 text-primary" />
                    <span className="truncate font-mono">{detectedJobUrl}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleScrapeJob}
                    disabled={scrapingJob}
                    className="h-7 shrink-0 px-2 text-[11px]"
                  >
                    {scrapingJob ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Scraping…
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-3 w-3" />
                        Fetch JD
                      </>
                    )}
                  </Button>
                </div>
              )}
              {scrapeError && (
                <p className="mt-2 text-[11px] text-destructive">{scrapeError}</p>
              )}
              {scrapedFrom && !detectedJobUrl && (
                <p className="mt-2 truncate text-[11px] text-muted-foreground">
                  Scraped from{" "}
                  <span className="font-mono text-primary/90">{scrapedFrom}</span>
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {jobDescription.length.toLocaleString()} chars · optional but
                unlocks match scoring.
              </p>
            </div>

            <Separator />

            <label
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                !!resume && !!jobDescription.trim()
                  ? "cursor-pointer border-border/60 bg-card/30 hover:border-border hover:bg-card/50"
                  : "cursor-not-allowed border-border/30 bg-card/10 opacity-60"
              }`}
            >
              <input
                type="checkbox"
                checked={autoTuneResume}
                onChange={(e) => setAutoTuneResume(e.target.checked)}
                disabled={!resume || !jobDescription.trim()}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
              <span className="leading-snug">
                <span className="font-medium text-foreground">
                  Also auto-tune my résumé
                </span>{" "}
                <span className="text-muted-foreground">
                  — fires automatically after the profile generates. Needs a
                  résumé and a job description.
                </span>
              </span>
            </label>

            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full"
            >
              {streaming ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Streaming…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate Career Context
                </>
              )}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Parsing and storage stay local. Cloud LLM calls go through the
              provider you pick.
            </p>
          </aside>

          {/* Right: Output */}
          <div className="space-y-6">
            <OutputPanel
              output={output}
              streaming={streaming}
              stages={stages}
              error={error}
              onStop={handleStop}
              startedAt={startedAt}
              finishedAt={finishedAt}
              usage={usage}
              footer={
                generationDone ? (
                  <ImproveContext
                    compact
                    provider={model?.provider ?? null}
                    model={model?.model ?? ""}
                    currentContext={output}
                    onRevised={(newContext) => setOutput(newContext)}
                  />
                ) : undefined
              }
            />

            {showLatexPanel && resume?.latexSource && (
              <LatexOutput
                originalTex={resume.latexSource}
                provider={model?.provider ?? null}
                model={model?.model ?? ""}
                jobDescription={jobDescription.trim() || null}
                careerContext={output}
              />
            )}

            {showCoverLetterPanel && (
              <CoverLetterOutput
                provider={model?.provider ?? null}
                model={model?.model ?? ""}
                resumeText={resume?.text ?? null}
                github={githubData}
                jobDescription={jobDescription.trim() || null}
                careerContext={output}
              />
            )}

            {showTunedResumePanel && resume && (
              <TunedResumeOutput
                provider={model?.provider ?? null}
                model={model?.model ?? ""}
                resumeText={resume.text}
                resumeKind={resume.kind}
                github={githubData}
                jobDescription={jobDescription.trim() || null}
                careerContext={generationDone ? output : null}
                triggerNonce={tuneTriggerNonce}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 mt-12">
        <div className="container flex flex-col items-center justify-between gap-2 py-4 text-[11px] text-muted-foreground sm:flex-row">
          <p>
            Built with Next.js · Tailwind · Vercel AI SDK. Local-first by
            default; cloud LLMs optional.
          </p>
          <p className="font-mono">v0.1.0</p>
        </div>
      </footer>
    </div>
  );
}
