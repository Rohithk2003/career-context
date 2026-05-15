"use client";
import * as React from "react";
import {
  FileCode2,
  Download,
  FileDown,
  Loader2,
  AlertCircle,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LlmProvider } from "@/lib/types";

interface Props {
  /** Raw LaTeX source of the user's uploaded résumé. */
  originalTex: string;
  /** LLM provider selected for the main generation. */
  provider: LlmProvider | null;
  /** Model identifier (provider-specific) — same one used for the main generation. */
  model: string;
  /** Optional target job description (already trimmed text or markdown). */
  jobDescription: string | null;
  /** The synthesised career-context markdown produced by /api/generate. */
  careerContext: string | null;
}

interface RegenResponse {
  latex?: string;
  error?: string;
  rawPreview?: string;
}

interface CompileErrorResponse {
  error?: string;
  hint?: string;
}

/**
 * Tailored-LaTeX output panel. Lives below the main career-context output and
 * only appears when the user uploaded a .tex resume AND the main generation
 * has produced something. Drives the two LaTeX endpoints:
 *
 *   POST /api/regenerate-latex  -> tailored .tex string
 *   POST /api/compile-latex     -> PDF blob (or 503 if toolchain missing)
 */
export function LatexOutput({
  originalTex,
  provider,
  model,
  jobDescription,
  careerContext,
}: Props) {
  const [latex, setLatex] = React.useState<string | null>(null);
  const [regenLoading, setRegenLoading] = React.useState(false);
  const [regenError, setRegenError] = React.useState<string | null>(null);

  const [compileLoading, setCompileLoading] = React.useState(false);
  const [compileError, setCompileError] = React.useState<string | null>(null);
  const [toolchainHint, setToolchainHint] = React.useState<string | null>(null);

  const handleRegenerate = async () => {
    setRegenError(null);
    setRegenLoading(true);
    setCompileError(null);
    setToolchainHint(null);
    try {
      const res = await fetch("/api/regenerate-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          originalTex,
          jobDescription,
          careerContext,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as RegenResponse;
      if (!res.ok || !data.latex) {
        throw new Error(data.error || `Regeneration failed (${res.status})`);
      }
      setLatex(data.latex);
    } catch (e) {
      setRegenError(
        e instanceof Error ? e.message : "Failed to regenerate LaTeX.",
      );
    } finally {
      setRegenLoading(false);
    }
  };

  const handleDownloadTex = () => {
    if (!latex) return;
    const blob = new Blob([latex], { type: "application/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume.tex";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    if (!latex) return;
    setCompileError(null);
    setToolchainHint(null);
    setCompileLoading(true);
    try {
      const res = await fetch("/api/compile-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      if (res.status === 503) {
        const data = (await res.json().catch(() => ({}))) as CompileErrorResponse;
        setCompileError(data.error || "LaTeX toolchain is not installed.");
        setToolchainHint(
          data.hint ||
            "Install Tectonic for a single-binary LaTeX engine: brew install tectonic",
        );
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as CompileErrorResponse;
        throw new Error(data.error || `Compile failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCompileError(
        e instanceof Error ? e.message : "PDF compilation failed.",
      );
    } finally {
      setCompileLoading(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm animate-fade-in"
      aria-label="Tailored LaTeX resume"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
            <FileCode2 className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">
              Tailored LaTeX Résumé
            </p>
            <p className="text-[11px] text-muted-foreground">
              Regenerate your .tex tuned to the career context and target role.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleRegenerate}
            disabled={regenLoading || !model || !provider}
            className="h-8"
          >
            {regenLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Regenerating…
              </>
            ) : latex ? (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </>
            ) : (
              <>
                <Wand2 className="h-3.5 w-3.5" />
                Regenerate LaTeX
              </>
            )}
          </Button>
          {latex && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadTex}
                className="h-8"
              >
                <Download className="h-3.5 w-3.5" />
                .tex
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadPdf}
                disabled={compileLoading}
                className="h-8"
              >
                {compileLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Compiling…
                  </>
                ) : (
                  <>
                    <FileDown className="h-3.5 w-3.5" />
                    .pdf
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </header>

      {(!model || !provider) && (
        <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
          Pick a model to enable LaTeX regeneration.
        </div>
      )}

      {regenError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="whitespace-pre-wrap break-words">{regenError}</span>
        </div>
      )}

      {compileError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
          <div className="flex items-start gap-2 text-destructive-foreground/90">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="whitespace-pre-wrap break-words">
              {compileError}
            </span>
          </div>
          {toolchainHint && (
            <p className="mt-2 pl-5.5 text-[11px] text-muted-foreground">
              {toolchainHint}
            </p>
          )}
        </div>
      )}

      {latex ? (
        <textarea
          readOnly
          value={latex}
          spellCheck={false}
          className={cn(
            "w-full resize-y rounded-md border border-border/60 bg-background/70 p-3 font-mono text-[11.5px] leading-relaxed text-foreground/90",
            "min-h-[260px] max-h-[520px] overflow-auto",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          )}
          aria-label="Tailored LaTeX source"
        />
      ) : (
        <div className="rounded-md border border-dashed border-border/60 bg-background/30 px-4 py-6 text-center text-xs text-muted-foreground">
          {regenLoading
            ? "Reshaping your résumé around the target role…"
            : "Click Regenerate to produce a tailored .tex from your uploaded résumé."}
        </div>
      )}
    </section>
  );
}
