import { NextRequest, NextResponse } from "next/server";
import { llmGenerateOnce, OllamaUnreachableError } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { buildTunedResumeLatexPrompt } from "@/lib/tuned-resume-prompts";
import { DEFAULT_TUNED_RESUME_TEMPLATE } from "@/lib/tuned-resume-template";
import { logRunAsync } from "@/lib/runs-log";
import type { LlmProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface TuneResumeLatexBody {
	provider?: LlmProvider;
	model?: string;
	tunedResumeMarkdown?: string;
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
	const body = (await req.json().catch(() => ({}))) as TuneResumeLatexBody;
	const provider = body.provider;
	const model = body.model?.trim();
	const tunedResumeMarkdown = body.tunedResumeMarkdown?.trim();

	if (!provider || !model) {
		return NextResponse.json(
			{ error: "Provider and model are required." },
			{ status: 400 },
		);
	}
	if (!tunedResumeMarkdown) {
		return NextResponse.json(
			{ error: "tunedResumeMarkdown is required." },
			{ status: 400 },
		);
	}

	const startedAt = Date.now();
	const inputs = {
		tunedResumeMarkdownChars: tunedResumeMarkdown.length,
	};

	try {
		const prompt = buildTunedResumeLatexPrompt({
			tunedResumeMarkdown,
			template: DEFAULT_TUNED_RESUME_TEMPLATE,
		});

		const raw = await llmGenerateOnce({
			provider,
			model,
			system: SYSTEM_PROMPT,
			prompt,
			temperature: 0.2,
			numCtx: 16_384,
			signal: req.signal,
		});

		const latex = stripFences(raw);

		if (!latex.startsWith("\\documentclass")) {
			logRunAsync({
				kind: "tuned-resume-latex",
				provider,
				model,
				durationMs: Date.now() - startedAt,
				inputs,
				output: null,
				error: "Model did not return a valid LaTeX document",
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
			kind: "tuned-resume-latex",
			provider,
			model,
			durationMs: Date.now() - startedAt,
			inputs,
			output: latex,
		});
		return NextResponse.json({ latex });
	} catch (err) {
		const msg =
			err instanceof OllamaUnreachableError
				? err.message
				: err instanceof Error
					? err.message
					: "Failed to build tuned-resume LaTeX.";
		logRunAsync({
			kind: "tuned-resume-latex",
			provider,
			model,
			durationMs: Date.now() - startedAt,
			inputs,
			output: null,
			error: msg,
		});
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
