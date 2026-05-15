import { NextRequest } from "next/server";
import {
  llmGenerateOnce,
  streamLlmGenerate,
  isProviderConfigured,
  OllamaUnreachableError,
} from "@/lib/llm";
import {
  SYSTEM_PROMPT,
  buildGithubEnrichmentPrompt,
  buildResumeUnderstandingPrompt,
  buildSynthesisPrompt,
} from "@/lib/prompts";
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

interface GenerateBody {
  provider?: string;
  model?: string;
  resumeText?: string | null;
  github?: GitHubProfileAggregate | null;
  jobDescription?: string | null;
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
  const body = (await req.json().catch(() => ({}))) as GenerateBody;
  const providerRaw = body.provider?.trim();
  const model = body.model?.trim();
  const resumeText = body.resumeText?.trim() || null;
  const github = body.github ?? null;
  const jobDescription = body.jobDescription?.trim() || null;

  if (!providerRaw || !VALID_PROVIDERS.has(providerRaw as LlmProvider)) {
    return new Response(
      JSON.stringify({
        error: `Invalid provider. Expected one of: ollama, anthropic, openai, google, claude-code, codex.`,
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

  if (!resumeText && !github && !jobDescription) {
    return new Response(
      JSON.stringify({
        error:
          "Provide at least one of: resume, GitHub profile, or job description.",
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
        // STEP 1 — Resume understanding (non-streamed, internal)
        let resumeDigest: string | null = null;
        if (resumeText) {
          send({ type: "stage", stage: "Reading resume", status: "start" });
          resumeDigest = await llmGenerateOnce({
            provider,
            model,
            system: SYSTEM_PROMPT,
            prompt: buildResumeUnderstandingPrompt(resumeText),
            temperature: 0.2,
            signal,
          });
          send({ type: "stage", stage: "Reading resume", status: "done" });
        }

        // STEP 2 — GitHub enrichment (non-streamed, internal)
        let githubDigest: string | null = null;
        if (github) {
          send({
            type: "stage",
            stage: "Analyzing GitHub activity",
            status: "start",
          });
          githubDigest = await llmGenerateOnce({
            provider,
            model,
            system: SYSTEM_PROMPT,
            prompt: buildGithubEnrichmentPrompt(github),
            temperature: 0.2,
            signal,
          });
          send({
            type: "stage",
            stage: "Analyzing GitHub activity",
            status: "done",
          });
        }

        // STEP 3 — Final synthesis (streamed to client)
        send({
          type: "stage",
          stage: jobDescription
            ? "Aligning to target role & synthesizing"
            : "Synthesizing career context",
          status: "start",
        });
        const finalPrompt = buildSynthesisPrompt({
          resumeDigest,
          githubDigest,
          jobDescription,
          hasResume: !!resumeText,
          hasGithub: !!github,
        });

        for await (const chunk of streamLlmGenerate({
          provider,
          model,
          system: SYSTEM_PROMPT,
          prompt: finalPrompt,
          temperature: 0.45,
          numCtx: 12_288,
          signal,
        })) {
          finalOutput += chunk;
          send({ type: "delta", text: chunk });
        }
        send({
          type: "stage",
          stage: "Synthesizing career context",
          status: "done",
        });
        send({ type: "done" });
      } catch (err) {
        const msg =
          err instanceof OllamaUnreachableError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error during generation";
        runError = msg;
        send({ type: "error", message: msg });
      } finally {
        logRunAsync({
          kind: "profile",
          provider,
          model,
          durationMs: Date.now() - startedAt,
          inputs: {
            resumeChars: resumeText?.length ?? 0,
            hasGithub: !!github,
            githubHandle: github?.username ?? null,
            jobDescriptionChars: jobDescription?.length ?? 0,
            jdSnippet: jobDescription?.slice(0, 200) ?? null,
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
