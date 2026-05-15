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

export interface RunRecord {
	kind: RunKind;
	provider: string;
	model: string;
	durationMs: number;
	inputs: Record<string, unknown>;
	output?: string | null;
	error?: string | null;
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
