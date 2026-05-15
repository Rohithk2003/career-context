import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Append-only JSONL log of every LLM run. Lives under `.runs/runs.jsonl` in
// the project root by default; override with CAREER_CONTEXT_RUNS_DIR. Writes
// are best-effort: a disk failure here must NEVER break the user-facing API.
//
// Each line is one JSON record. JSONL was picked over a single JSON array so
// concurrent appends from multiple in-flight requests don't fight over the
// whole file — each request appends one line, atomic on POSIX for short
// writes.
//
// Caveat: this only persists when the server has write access to the FS.
// Vercel / serverless deployments have read-only or ephemeral storage; in
// those environments these writes silently no-op (and log to stderr).

export type RunKind =
	| "profile"
	| "cover-letter"
	| "cover-letter-latex"
	| "resume-latex"
	| "tuned-resume"
	| "tuned-resume-latex"
	| "improve-context";

export interface RunUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalDurationMs?: number;
	evalDurationMs?: number;
	promptEvalDurationMs?: number;
	costUsd?: number;
}

export interface RunRecord {
	kind: RunKind;
	provider: string;
	model: string;
	durationMs: number;
	inputs: Record<string, unknown>;
	output?: string | null;
	error?: string | null;
	/** Token usage / cost when the provider exposed it. Each provider fills
	 *  a different subset; absent fields mean the provider didn't report. */
	usage?: RunUsage;
}

function runsDir(): string {
	const override = process.env.CAREER_CONTEXT_RUNS_DIR?.trim();
	if (override) return override;
	return path.join(process.cwd(), ".runs");
}

function runsFile(): string {
	return path.join(runsDir(), "runs.jsonl");
}

export async function logRun(record: RunRecord): Promise<void> {
	const entry = {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		...record,
	};
	const line = JSON.stringify(entry) + "\n";
	try {
		await fs.mkdir(runsDir(), { recursive: true });
		await fs.appendFile(runsFile(), line, "utf8");
	} catch (err) {
		// Best-effort: never propagate. Log to stderr so it shows up in dev.
		console.error("[runs-log] failed to append run:", err);
	}
}

/**
 * Fire-and-forget convenience — use from API routes when you don't want to
 * await the log write. Errors are swallowed inside logRun.
 */
export function logRunAsync(record: RunRecord): void {
	void logRun(record);
}

/**
 * Build a usage accumulator for routes that make one or more LLM calls.
 * The returned `onUsage` is wired into each call's `onUsage` option; the
 * returned `snapshot` produces a final RunUsage to attach to the log,
 * dropping zero-valued fields so the JSONL stays compact.
 */
export function makeUsageAccumulator(): {
	onUsage: (u: RunUsage) => void;
	snapshot: () => RunUsage;
} {
	const acc = {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
		costUsd: 0,
	};
	return {
		onUsage(u: RunUsage) {
			if (u.inputTokens) acc.inputTokens += u.inputTokens;
			if (u.outputTokens) acc.outputTokens += u.outputTokens;
			if (u.cacheCreationInputTokens)
				acc.cacheCreationInputTokens += u.cacheCreationInputTokens;
			if (u.cacheReadInputTokens)
				acc.cacheReadInputTokens += u.cacheReadInputTokens;
			if (u.costUsd) acc.costUsd += u.costUsd;
		},
		snapshot() {
			const out: RunUsage = {};
			if (acc.inputTokens) out.inputTokens = acc.inputTokens;
			if (acc.outputTokens) out.outputTokens = acc.outputTokens;
			if (acc.cacheCreationInputTokens)
				out.cacheCreationInputTokens = acc.cacheCreationInputTokens;
			if (acc.cacheReadInputTokens)
				out.cacheReadInputTokens = acc.cacheReadInputTokens;
			if (acc.costUsd) out.costUsd = acc.costUsd;
			return out;
		},
	};
}
