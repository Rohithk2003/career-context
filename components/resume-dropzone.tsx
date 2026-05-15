"use client";
import * as React from "react";
import { useDropzone } from "react-dropzone";
import {
	FileText,
	Loader2,
	UploadCloud,
	X,
	CheckCircle2,
	AlertCircle,
	Clock,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import type { ParsedResume } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface Props {
	onParsed: (resume: ParsedResume) => void;
	parsed: ParsedResume | null;
	onClear: () => void;
}

// --- localStorage cache ------------------------------------------------------
// Persist the parsed resume across reloads so users don't have to re-upload
// every visit. Single-slot — replaced when a new file is parsed; cleared when
// the user removes it. Wrapped in try/catch for quota / disabled-storage.
const CACHE_KEY = "resume-cache";
// Bump when ParsedResume's shape changes in a way that would break older
// cached entries on deserialize. Mismatched versions are treated as absent.
const CACHE_VERSION = 1;

interface CacheEntry {
	version: number;
	parsed: ParsedResume;
	savedAt: number;
}

function loadCache(): CacheEntry | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const entry = JSON.parse(raw) as CacheEntry;
		if (entry?.version !== CACHE_VERSION) return null;
		if (!entry.parsed || typeof entry.savedAt !== "number") return null;
		return entry;
	} catch {
		return null;
	}
}

function saveCache(parsed: ParsedResume): number | null {
	if (typeof window === "undefined") return null;
	const savedAt = Date.now();
	try {
		window.localStorage.setItem(
			CACHE_KEY,
			JSON.stringify({
				version: CACHE_VERSION,
				parsed,
				savedAt,
			} satisfies CacheEntry),
		);
		return savedAt;
	} catch {
		// Quota exceeded or storage disabled — don't claim success.
		return null;
	}
}

function clearCache() {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(CACHE_KEY);
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

export function ResumeDropzone({ onParsed, parsed, onClear }: Props) {
	const [uploading, setUploading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [savedAt, setSavedAt] = React.useState<number | null>(null);
	const [fromCache, setFromCache] = React.useState(false);

	// Restore the most recent cached resume on mount, unless the parent already
	// holds one. Lets the user pick up where they left off without re-uploading.
	React.useEffect(() => {
		if (parsed) return;
		const cached = loadCache();
		if (cached) {
			onParsed(cached.parsed);
			setSavedAt(cached.savedAt);
			setFromCache(true);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleFile = React.useCallback(
		async (file: File) => {
			setError(null);
			setUploading(true);
			try {
				// If the upload is a LaTeX source file, capture the raw text on the
				// client so the downstream regen pipeline can rewrite it verbatim.
				// We still POST to /api/parse-resume so the plain-text extraction
				// path stays consistent with PDF/DOCX uploads.
				const isTex = /\.(tex|latex)$/i.test(file.name);
				const latexSource = isTex ? await file.text() : null;

				const fd = new FormData();
				fd.append("file", file);
				const res = await fetch("/api/parse-resume", {
					method: "POST",
					body: fd,
				});
				const data = await res.json();
				if (!res.ok)
					throw new Error(data?.error || `Upload failed (${res.status})`);
				const parsed = data as ParsedResume;
				if (latexSource) parsed.latexSource = latexSource;
				const at = saveCache(parsed);
				setSavedAt(at);
				setFromCache(false);
				onParsed(parsed);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to parse resume");
			} finally {
				setUploading(false);
			}
		},
		[onParsed],
	);

	const handleClear = React.useCallback(() => {
		clearCache();
		setSavedAt(null);
		setFromCache(false);
		onClear();
	}, [onClear]);

	const { getRootProps, getInputProps, isDragActive, isDragReject } =
		useDropzone({
			onDrop: (accepted, rejections) => {
				if (rejections.length > 0) {
					const r = rejections[0];
					setError(r.errors[0]?.message ?? "File rejected");
					return;
				}
				const file = accepted[0];
				if (file) handleFile(file);
			},
			multiple: false,
			maxSize: 8 * 1024 * 1024,
			accept: {
				"application/pdf": [".pdf"],
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
					[".docx"],
				"application/x-tex": [".tex", ".latex"],
				"text/x-tex": [".tex"],
				"text/plain": [".txt"],
				"text/markdown": [".md"],
			},
		});

	if (parsed) {
		return (
			<div className="space-y-2">
				<div className="rounded-lg border border-border/80 bg-card/60 p-4 animate-fade-in">
					<div className="flex items-start gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
							<FileText className="h-5 w-5 text-primary" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<p className="truncate text-sm font-medium">{parsed.fileName}</p>
								<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
							</div>
							<p className="mt-0.5 text-xs text-muted-foreground">
								{parsed.kind.toUpperCase()} · {formatBytes(parsed.bytes)} ·{" "}
								{parsed.charCount.toLocaleString()} chars
								{parsed.truncated && " · truncated"}
							</p>
						</div>
						<Button
							size="icon"
							variant="ghost"
							onClick={handleClear}
							aria-label="Remove resume"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
				{savedAt && (
					<div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
						<Clock className="h-3 w-3 shrink-0" />
						<span className="truncate">
							{fromCache ? "Restored" : "Saved"} {formatAge(savedAt)} · Remove to
							upload a new resume
						</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div>
			<div
				{...getRootProps()}
				className={cn(
					"group relative rounded-xl border border-dashed border-border bg-card/30 px-5 py-8 text-center transition-all cursor-pointer",
					"hover:border-primary/50 hover:bg-card/60",
					isDragActive && "border-primary bg-primary/5 glow-purple",
					isDragReject && "border-destructive/60 bg-destructive/5",
					uploading && "pointer-events-none opacity-70",
				)}
			>
				<input {...getInputProps()} />
				<div className="flex flex-col items-center gap-2">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20 transition-transform group-hover:scale-105">
						{uploading ? (
							<Loader2 className="h-5 w-5 animate-spin text-primary" />
						) : (
							<UploadCloud className="h-5 w-5 text-primary" />
						)}
					</div>
					<p className="text-sm font-medium">
						{uploading
							? "Extracting text..."
							: isDragActive
								? "Drop to parse"
								: "Drop resume or click to upload"}
					</p>
					<p className="text-xs text-muted-foreground">
						PDF, DOCX, LaTeX, TXT, or Markdown · up to 8MB · processed locally
					</p>
				</div>
			</div>
			{error && (
				<div className="mt-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
					<AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
					{error}
				</div>
			)}
		</div>
	);
}
