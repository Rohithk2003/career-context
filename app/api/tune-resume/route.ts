import { NextRequest } from "next/server";
import {
	streamLlmGenerate,
	isProviderConfigured,
	OllamaUnreachableError,
} from "@/lib/llm";
import {
	buildTunedResumeMarkdownPrompt,
	TUNED_RESUME_SYSTEM_PROMPT,
} from "@/lib/tuned-resume-prompts";
import { logRunAsync } from "@/lib/runs-log";
import { sanitizeAsciiPunctuation } from "@/lib/utils";
import type { GitHubProfileAggregate, LlmProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_PROVIDERS: ReadonlySet<LlmProvider> = new Set([
	"ollama",
	"anthropic",
	"openai",
	"google",
	"claude-code",
	"codex",
]);

interface TuneResumeBody {
	provider?: string;
	model?: string;
	resumeText?: string | null;
	github?: GitHubProfileAggregate | null;
	jobDescription?: string | null;
	careerContext?: string | null;
}

type StageEvent =
	| { type: "stage"; stage: string; status: "start" | "done" }
	| { type: "delta"; text: string }
	| { type: "error"; message: string }
	| { type: "done" };

function sseEncode(ev: StageEvent): string {
	return `data: ${JSON.stringify(ev)}\n\n`;
}

export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as TuneResumeBody;
	const providerRaw = body.provider?.trim();
	const model = body.model?.trim();
	const resumeText = body.resumeText?.trim() || null;
	const github = body.github ?? null;
	const jobDescription = body.jobDescription?.trim() || null;
	const careerContext = body.careerContext?.trim() || null;

	if (!providerRaw || !VALID_PROVIDERS.has(providerRaw as LlmProvider)) {
		return new Response(
			JSON.stringify({
				error: `Invalid provider. Expected one of: ${[...VALID_PROVIDERS].join(", ")}.`,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}
	const provider = providerRaw as LlmProvider;

	if (!model) {
		return new Response(JSON.stringify({ error: "Model is required." }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (provider !== "ollama" && !isProviderConfigured(provider)) {
		return new Response(
			JSON.stringify({
				error: `Provider \"${provider}\" is not configured. Set the corresponding API key environment variable.`,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}

	if (!resumeText) {
		return new Response(
			JSON.stringify({
				error: "Resume text is required to auto-tune the resume.",
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}
	if (!jobDescription) {
		return new Response(
			JSON.stringify({
				error: "Job description is required to auto-tune the resume.",
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const enc = new TextEncoder();
			const send = (ev: StageEvent) =>
				controller.enqueue(enc.encode(sseEncode(ev)));
			const signal = req.signal;
			const startedAt = Date.now();
			let finalOutput = "";
			let runError: string | null = null;

			try {
				send({ type: "stage", stage: "Tuning resume to JD", status: "start" });
				const prompt = buildTunedResumeMarkdownPrompt({
					resumeText,
					github,
					jobDescription,
					careerContext,
				});

				for await (const chunk of streamLlmGenerate({
					provider,
					model,
					system: TUNED_RESUME_SYSTEM_PROMPT,
					prompt,
					// Higher than profile synthesis: rewriting needs room to vary
					// phrasing. Low temperatures make the model "play it safe" and
					// echo the original input verbatim — exactly what we don't want.
					// 0.65 pushes the model out of the "safest = repeat" attractor.
					temperature: 0.65,
					numCtx: 16_384,
					signal,
				})) {
					// Strip em-dashes / smart quotes / bullets / etc. so the résumé
					// is ASCII-clean for ATS systems. Per-chunk is safe because our
					// upstream adapter (streamLlmGenerate) yields fully-decoded UTF-8
					// strings per LLM delta event, not raw byte fragments.
					const clean = sanitizeAsciiPunctuation(chunk);
					finalOutput += clean;
					send({ type: "delta", text: clean });
				}
				send({ type: "stage", stage: "Tuning resume to JD", status: "done" });
				send({ type: "done" });
			} catch (err) {
				const msg =
					err instanceof OllamaUnreachableError
						? err.message
						: err instanceof Error
							? err.message
							: "Unknown error during resume tuning";
				runError = msg;
				send({ type: "error", message: msg });
			} finally {
				logRunAsync({
					kind: "tuned-resume",
					provider,
					model,
					durationMs: Date.now() - startedAt,
					inputs: {
						resumeChars: resumeText.length,
						hasGithub: !!github,
						githubHandle: github?.username ?? null,
						jobDescriptionChars: jobDescription.length,
						careerContextChars: careerContext?.length ?? 0,
					},
					output: runError ? null : finalOutput,
					error: runError,
				});
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
