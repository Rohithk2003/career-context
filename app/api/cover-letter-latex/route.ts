import { NextRequest, NextResponse } from "next/server";
import { llmGenerateOnce, OllamaUnreachableError } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { buildCoverLetterLatexPrompt } from "@/lib/cover-letter-prompts";
import { DEFAULT_COVER_LETTER_TEMPLATE } from "@/lib/cover-letter-template";
import { logRunAsync, makeUsageAccumulator } from "@/lib/runs-log";
import type { LlmProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CoverLetterLatexBody {
	provider?: LlmProvider;
	model?: string;
	coverLetterMarkdown?: string;
}

function stripFences(raw: string): string {
	let s = raw.trim();
	const fenceOpen = /^```[a-zA-Z]*\s*\n?/;
	if (fenceOpen.test(s)) s = s.replace(fenceOpen, "");
	s = s.replace(/\n?```\s*$/, "");
	const docIdx = s.indexOf("\\documentclass");
	if (docIdx > 0) s = s.slice(docIdx);
	const endIdx = s.indexOf("\\end{document}");
	if (endIdx !== -1) {
		s = s.slice(0, endIdx + "\\end{document}".length);
	}
	return s.trim();
}

export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as CoverLetterLatexBody;
	const provider = body.provider;
	const model = body.model?.trim();
	const coverLetterMarkdown = body.coverLetterMarkdown?.trim();

	if (!provider || !model) {
		return NextResponse.json(
			{ error: "Provider and model are required." },
			{ status: 400 },
		);
	}
	if (!coverLetterMarkdown) {
		return NextResponse.json(
			{ error: "coverLetterMarkdown is required." },
			{ status: 400 },
		);
	}

	const startedAt = Date.now();
	const inputs = {
		coverLetterMarkdownChars: coverLetterMarkdown.length,
	};
	const { onUsage, snapshot: usageSnapshot } = makeUsageAccumulator();

	try {
		const prompt = buildCoverLetterLatexPrompt({
			coverLetterMarkdown,
			template: DEFAULT_COVER_LETTER_TEMPLATE,
		});

		const raw = await llmGenerateOnce({
			provider,
			model,
			system: SYSTEM_PROMPT,
			prompt,
			temperature: 0.2,
			numCtx: 12_288,
			signal: req.signal,
			onUsage,
		});

		const latex = stripFences(raw);

		if (!latex.startsWith("\\documentclass")) {
			logRunAsync({
				kind: "cover-letter-latex",
				provider,
				model,
				durationMs: Date.now() - startedAt,
				inputs,
				output: null,
				error: "Model did not return a valid LaTeX document",
				usage: usageSnapshot(),
			});
			return NextResponse.json(
				{
					error:
						"Model did not return a valid LaTeX document — output did not start with \\documentclass. Try a different model or retry.",
					rawPreview: raw.slice(0, 400),
				},
				{ status: 502 },
			);
		}

		logRunAsync({
			kind: "cover-letter-latex",
			provider,
			model,
			durationMs: Date.now() - startedAt,
			inputs,
			output: latex,
			usage: usageSnapshot(),
		});
		return NextResponse.json({ latex });
	} catch (err) {
		const msg =
			err instanceof OllamaUnreachableError
				? err.message
				: err instanceof Error
					? err.message
					: "Failed to build cover-letter LaTeX.";
		logRunAsync({
			kind: "cover-letter-latex",
			provider,
			model,
			durationMs: Date.now() - startedAt,
			inputs,
			output: null,
			error: msg,
			usage: usageSnapshot(),
		});
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
