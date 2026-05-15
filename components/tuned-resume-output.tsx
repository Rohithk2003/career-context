"use client";
import * as React from "react";
import {
	FileText,
	Wand2,
	RefreshCw,
	Loader2,
	AlertCircle,
	Copy,
	Check,
	Download,
	FileDown,
	Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import type { GitHubProfileAggregate, LlmProvider } from "@/lib/types";

interface Props {
	provider: LlmProvider | null;
	model: string;
	resumeText: string | null;
	github: GitHubProfileAggregate | null;
	jobDescription: string | null;
	careerContext: string | null;
}

type SseEvent =
	| { type: "stage"; stage: string; status: "start" | "done" }
	| { type: "delta"; text: string }
	| { type: "error"; message: string }
	| { type: "done" };

interface LatexResponse {
	latex?: string;
	error?: string;
	rawPreview?: string;
}

interface CompileErrorResponse {
	error?: string;
	hint?: string;
}

export function TunedResumeOutput({
	provider,
	model,
	resumeText,
	github,
	jobDescription,
	careerContext,
}: Props) {
	const [output, setOutput] = React.useState("");
	const [streaming, setStreaming] = React.useState(false);
	const [streamError, setStreamError] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState(false);

	const [latex, setLatex] = React.useState<string | null>(null);
	const [latexLoading, setLatexLoading] = React.useState(false);
	const [latexError, setLatexError] = React.useState<string | null>(null);

	const [pdfLoading, setPdfLoading] = React.useState(false);
	const [pdfError, setPdfError] = React.useState<string | null>(null);
	const [toolchainHint, setToolchainHint] = React.useState<string | null>(null);

	const abortRef = React.useRef<AbortController | null>(null);

	const canGenerate =
		!!provider && !!model && !!resumeText && !!jobDescription && !streaming;

	const handleGenerate = async () => {
		if (!canGenerate) return;
		setStreamError(null);
		setOutput("");
		setLatex(null);
		setLatexError(null);
		setPdfError(null);
		setToolchainHint(null);
		setStreaming(true);

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const res = await fetch("/api/tune-resume", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider,
					model,
					resumeText,
					github,
					jobDescription,
					careerContext,
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
					} else if (event.type === "error") {
						setStreamError(event.message);
					}
				}
			}
		} catch (e) {
			if ((e as Error).name !== "AbortError") {
				setStreamError(
					e instanceof Error ? e.message : "Resume tuning failed",
				);
			}
		} finally {
			setStreaming(false);
			abortRef.current = null;
		}
	};

	const handleStop = () => {
		abortRef.current?.abort();
	};

	const handleCopy = async () => {
		if (!output) return;
		await navigator.clipboard.writeText(output);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const handleDownloadMd = () => {
		if (!output) return;
		const blob = new Blob([output], { type: "text/markdown" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "resume-tuned.md";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	};

	const ensureLatex = async (): Promise<string | null> => {
		if (latex) return latex;
		if (!output || !provider || !model) return null;
		setLatexLoading(true);
		setLatexError(null);
		try {
			const res = await fetch("/api/tune-resume-latex", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider,
					model,
					tunedResumeMarkdown: output,
				}),
			});
			const data = (await res.json().catch(() => ({}))) as LatexResponse;
			if (!res.ok || !data.latex) {
				throw new Error(data.error || `LaTeX build failed (${res.status})`);
			}
			setLatex(data.latex);
			return data.latex;
		} catch (e) {
			setLatexError(
				e instanceof Error ? e.message : "Failed to build LaTeX resume.",
			);
			return null;
		} finally {
			setLatexLoading(false);
		}
	};

	const handleDownloadTex = async () => {
		const tex = await ensureLatex();
		if (!tex) return;
		const blob = new Blob([tex], { type: "application/x-tex" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "resume-tuned.tex";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	};

	const handleDownloadPdf = async () => {
		const tex = await ensureLatex();
		if (!tex) return;
		setPdfError(null);
		setToolchainHint(null);
		setPdfLoading(true);
		try {
			const res = await fetch("/api/compile-latex", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ latex: tex }),
			});
			if (res.status === 503) {
				const data = (await res
					.json()
					.catch(() => ({}))) as CompileErrorResponse;
				setPdfError(data.error || "LaTeX toolchain is not installed.");
				setToolchainHint(
					data.hint ||
						"Install Tectonic for a single-binary LaTeX engine: brew install tectonic",
				);
				return;
			}
			if (!res.ok) {
				const data = (await res
					.json()
					.catch(() => ({}))) as CompileErrorResponse;
				throw new Error(data.error || `Compile failed (${res.status})`);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "resume-tuned.pdf";
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (e) {
			setPdfError(e instanceof Error ? e.message : "PDF compilation failed.");
		} finally {
			setPdfLoading(false);
		}
	};

	const hasOutput = !!output;
	const ready = !!provider && !!model && !!resumeText && !!jobDescription;

	return (
		<section
			className="rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm animate-fade-in"
			aria-label="Auto-tuned resume"
		>
			<header className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
						<FileText className="h-3.5 w-3.5 text-primary" />
					</div>
					<div className="leading-tight">
						<p className="text-sm font-semibold tracking-tight">
							Auto-Tuned Résumé
						</p>
						<p className="text-[11px] text-muted-foreground">
							Your résumé sharpened around the target role — never invents
							experience.
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{streaming ? (
						<Button
							size="sm"
							variant="outline"
							onClick={handleStop}
							className="h-8"
						>
							<Square className="h-3 w-3 fill-current" />
							Stop
						</Button>
					) : (
						<Button
							size="sm"
							onClick={handleGenerate}
							disabled={!canGenerate}
							className="h-8"
						>
							{hasOutput ? (
								<>
									<RefreshCw className="h-3.5 w-3.5" />
									Regenerate
								</>
							) : (
								<>
									<Wand2 className="h-3.5 w-3.5" />
									Auto-tune resume
								</>
							)}
						</Button>
					)}
					{hasOutput && !streaming && (
						<>
							<Button
								size="sm"
								variant="ghost"
								onClick={handleCopy}
								className="h-8"
							>
								{copied ? (
									<Check className="h-3.5 w-3.5 text-emerald-400" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
								{copied ? "Copied" : "Copy"}
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={handleDownloadMd}
								className="h-8"
							>
								<Download className="h-3.5 w-3.5" />
								.md
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={handleDownloadTex}
								disabled={latexLoading}
								className="h-8"
							>
								{latexLoading ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Download className="h-3.5 w-3.5" />
								)}
								.tex
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={handleDownloadPdf}
								disabled={pdfLoading || latexLoading}
								className="h-8"
							>
								{pdfLoading ? (
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

			{!ready && (
				<div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
					Upload a resume and paste a job description — both are required to
					auto-tune.
				</div>
			)}

			{streamError && (
				<div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
					<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
					<span className="whitespace-pre-wrap break-words">{streamError}</span>
				</div>
			)}

			{latexError && (
				<div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
					<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
					<span className="whitespace-pre-wrap break-words">{latexError}</span>
				</div>
			)}

			{pdfError && (
				<div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
					<div className="flex items-start gap-2 text-destructive-foreground/90">
						<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
						<span className="whitespace-pre-wrap break-words">{pdfError}</span>
					</div>
					{toolchainHint && (
						<p className="mt-2 pl-5.5 text-[11px] text-muted-foreground">
							{toolchainHint}
						</p>
					)}
				</div>
			)}

			{hasOutput ? (
				<div className="rounded-md border border-border/60 bg-background/40 px-4 py-3">
					<Markdown source={output} />
					{streaming && (
						<span
							aria-hidden
							className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-primary align-middle"
						/>
					)}
				</div>
			) : (
				<div className="rounded-md border border-dashed border-border/60 bg-background/30 px-4 py-6 text-center text-xs text-muted-foreground">
					{streaming
						? "Tuning your résumé…"
						: "Click \"Auto-tune resume\" to produce a tailored Markdown résumé from your upload."}
				</div>
			)}
		</section>
	);
}
