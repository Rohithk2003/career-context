import { NextRequest } from "next/server";
import {
	streamLlmGenerate,
	isProviderConfigured,
	OllamaUnreachableError,
} from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { buildCoverLetterMarkdownPrompt } from "@/lib/cover-letter-prompts";
import { logRunAsync } from "@/lib/runs-log";
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

interface GenerateCoverLetterBody {
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
	const body = (await req
		.json()
		.catch(() => ({}))) as GenerateCoverLetterBody;
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

	if (!jobDescription) {
		return new Response(
			JSON.stringify({
				error: "Job description is required to generate a cover letter.",
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}
	if (!careerContext) {
		return new Response(
			JSON.stringify({
				error:
					"Career context is required. Generate the profile first, then the cover letter.",
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
				send({ type: "stage", stage: "Writing cover letter", status: "start" });
				const prompt = buildCoverLetterMarkdownPrompt({
					resumeText,
					github,
					jobDescription,
					careerContext,
				});

				for await (const chunk of streamLlmGenerate({
					provider,
					model,
					system: SYSTEM_PROMPT,
					prompt,
					temperature: 0.5,
					numCtx: 12_288,
					signal,
				})) {
					finalOutput += chunk;
					send({ type: "delta", text: chunk });
				}
				send({ type: "stage", stage: "Writing cover letter", status: "done" });
				send({ type: "done" });
			} catch (err) {
				const msg =
					err instanceof OllamaUnreachableError
						? err.message
						: err instanceof Error
							? err.message
							: "Unknown error during cover letter generation";
				runError = msg;
				send({ type: "error", message: msg });
			} finally {
				logRunAsync({
					kind: "cover-letter",
					provider,
					model,
					durationMs: Date.now() - startedAt,
					inputs: {
						resumeChars: resumeText?.length ?? 0,
						hasGithub: !!github,
						githubHandle: github?.username ?? null,
						jobDescriptionChars: jobDescription.length,
						careerContextChars: careerContext.length,
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
