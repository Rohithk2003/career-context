"use client";
import * as React from "react";
import {
  Copy,
  Download,
  Check,
  Sparkles,
  Square,
  Loader2,
  AlertCircle,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

export interface StageState {
  label: string;
  status: "active" | "done";
}

interface Props {
  output: string;
  streaming: boolean;
  stages: StageState[];
  error: string | null;
  onStop: () => void;
  startedAt: number | null;
  finishedAt: number | null;
}

export function OutputPanel({
  output,
  streaming,
  stages,
  error,
  onStop,
  startedAt,
  finishedAt,
}: Props) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleExport = (kind: "md" | "txt") => {
    if (!output) return;
    const blob = new Blob([output], {
      type: kind === "md" ? "text/markdown" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `career-context-${new Date().toISOString().slice(0, 10)}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const elapsed =
    startedAt && (finishedAt ?? Date.now())
      ? ((finishedAt ?? Date.now()) - startedAt) / 1000
      : null;

  const isEmpty = !output && !streaming && !error;

  return (
    <div className="flex h-full min-h-[640px] flex-col rounded-xl border border-border/80 bg-card/40 backdrop-blur-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Career Context Profile
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {streaming
                ? "Generating in your local model..."
                : output
                  ? "Ready to copy or export"
                  : "Output will appear here as the model streams"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {streaming ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              className="gap-1.5"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </Button>
          ) : output ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="gap-1.5"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleExport("md")}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                .md
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-5 py-2.5">
          {stages.map((s, i) => (
            <div
              key={i}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                s.status === "active"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300/90",
              )}
            >
              {s.status === "active" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {s.label}
            </div>
          ))}
          {elapsed !== null && (
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {elapsed.toFixed(1)}s
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/5 ring-1 ring-primary/10">
              <Sparkles className="h-5 w-5 text-primary/60" />
            </div>
            <h3 className="mt-4 text-sm font-medium text-foreground">
              Your profile starts here
            </h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Add a resume, GitHub handle, or job description on the left, pick a
              local model, and click <em>Generate</em>. The output streams here
              token by token.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive-foreground">
                Generation failed
              </p>
              <p className="mt-0.5 text-xs text-destructive-foreground/80">
                {error}
              </p>
            </div>
          </div>
        )}

        {output && (
          <div className="animate-fade-in">
            <Markdown source={output} />
            {streaming && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-primary align-middle"
              />
            )}
          </div>
        )}

        {!output && streaming && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleDot className="h-3.5 w-3.5 animate-pulse text-primary" />
            Warming up the model and processing your inputs…
          </div>
        )}
      </div>
    </div>
  );
}
