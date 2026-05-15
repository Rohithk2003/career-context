import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import type { RunRecord } from "@/lib/runs-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A persisted run record includes the id and timestamp added by `logRun` at
// the point of write. Re-derived from RunRecord so we don't drift if the
// upstream type changes.
export type PersistedRun = RunRecord & { id: string; timestamp: string };

const MAX_RUNS = 500;

function runsFile(): string {
	const override = process.env.CAREER_CONTEXT_RUNS_DIR?.trim();
	const dir = override || path.join(process.cwd(), ".runs");
	return path.join(dir, "runs.jsonl");
}

export async function GET() {
	const file = runsFile();
	let contents: string;
	try {
		contents = await fs.readFile(file, "utf8");
	} catch (err: unknown) {
		// ENOENT = file not yet created. Treat as empty log, not an error.
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code?: string }).code === "ENOENT"
		) {
			return NextResponse.json({ runs: [] }, { status: 200 });
		}
		return NextResponse.json(
			{
				error:
					err instanceof Error ? err.message : "Failed to read runs log",
			},
			{ status: 500 },
		);
	}

	const lines = contents.split("\n");
	const runs: PersistedRun[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as PersistedRun;
			// Defensive: only keep entries that look well-formed enough to render.
			if (
				parsed &&
				typeof parsed.id === "string" &&
				typeof parsed.timestamp === "string" &&
				typeof parsed.kind === "string"
			) {
				runs.push(parsed);
			}
		} catch {
			// Skip malformed line — best-effort log replay.
		}
	}

	// Newest first, capped at MAX_RUNS so the response stays bounded.
	runs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
	const capped = runs.slice(0, MAX_RUNS);

	return NextResponse.json({ runs: capped }, { status: 200 });
}
