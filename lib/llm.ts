import { generateText, streamText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import {
  listOllamaModels,
  ollamaGenerateOnce,
  streamOllamaGenerate,
  OllamaUnreachableError,
  OLLAMA_BASE_URL,
} from "./ollama";
import {
  isClaudeCodeAvailable,
  generateOnceClaudeCode,
  streamClaudeCode,
  ClaudeCodeMissingError,
} from "./claude-code";
import {
  isCodexAvailable,
  generateOnceCodex,
  streamCodex,
  CodexMissingError,
} from "./codex-cli";
import type { LlmProvider } from "./types";

export type { LlmProvider } from "./types";

export interface LlmModel {
  provider: LlmProvider;
  id: string;
  label: string;
}

interface GenerateOpts {
  provider: LlmProvider;
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
  numCtx?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Curated cloud model catalogues. Kept in code (not config) so the UI can show
// the same options across environments and we don't have to fan-out probe
// calls just to populate a <Select>.
// ---------------------------------------------------------------------------
const ANTHROPIC_MODELS: LlmModel[] = [
  { provider: "anthropic", id: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { provider: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

const OPENAI_MODELS: LlmModel[] = [
  { provider: "openai", id: "gpt-5", label: "GPT-5" },
  { provider: "openai", id: "gpt-5-mini", label: "GPT-5 mini" },
  { provider: "openai", id: "o4-mini", label: "o4-mini" },
];

const GOOGLE_MODELS: LlmModel[] = [
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { provider: "google", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  {
    provider: "google",
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
  },
];

// Claude Code CLI — uses the user's Claude Pro/Max subscription, not API billing.
// Requires `claude` on PATH and a prior `claude /login`.
const CLAUDE_CODE_MODELS: LlmModel[] = [
  { provider: "claude-code", id: "opus", label: "Claude Code · Opus" },
  { provider: "claude-code", id: "sonnet", label: "Claude Code · Sonnet" },
  { provider: "claude-code", id: "haiku", label: "Claude Code · Haiku" },
];

// OpenAI Codex CLI — uses the user's ChatGPT Plus/Pro subscription, not API
// billing. Requires `codex` on PATH and a prior `codex login`.
const CODEX_MODELS: LlmModel[] = [
  { provider: "codex", id: "gpt-5-codex", label: "Codex · GPT-5 Codex" },
  { provider: "codex", id: "gpt-5", label: "Codex · GPT-5" },
];

export function isProviderConfigured(provider: LlmProvider): boolean {
  switch (provider) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "google":
      return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "ollama":
      // Always considered "configured" — reachability is verified at list time.
      return true;
    case "claude-code":
    case "codex":
      // Reported as "configured" — actual binary presence is async-checked in
      // listAvailableModels so we can keep this fn synchronous.
      return true;
  }
}

export interface AvailableModels {
  models: LlmModel[];
  errors: Partial<Record<LlmProvider, string>>;
}

/**
 * Returns every model the user can actually pick right now:
 *   - dynamic Ollama models (best-effort — failure surfaces via `errors.ollama`)
 *   - curated cloud models for each provider with an API key set
 *   - Claude Code / Codex CLI models when their binaries are on PATH
 *
 * Never throws on a single-provider failure — one broken provider should not
 * hide the others.
 */
export async function listAvailableModels(): Promise<AvailableModels> {
  const out: LlmModel[] = [];
  const errors: Partial<Record<LlmProvider, string>> = {};

  try {
    const ollamaModels = await listOllamaModels();
    for (const m of ollamaModels) {
      const sizeLabel = m.details?.parameter_size;
      out.push({
        provider: "ollama",
        id: m.name,
        label: sizeLabel ? `${m.name} (${sizeLabel})` : m.name,
      });
    }
  } catch (err) {
    errors.ollama =
      err instanceof OllamaUnreachableError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown error listing Ollama models";
  }

  if (isProviderConfigured("anthropic")) out.push(...ANTHROPIC_MODELS);
  if (isProviderConfigured("openai")) out.push(...OPENAI_MODELS);
  if (isProviderConfigured("google")) out.push(...GOOGLE_MODELS);

  try {
    if (await isClaudeCodeAvailable()) out.push(...CLAUDE_CODE_MODELS);
  } catch (err) {
    errors["claude-code"] =
      err instanceof Error ? err.message : "claude binary check failed";
  }
  try {
    if (await isCodexAvailable()) out.push(...CODEX_MODELS);
  } catch (err) {
    errors.codex =
      err instanceof Error ? err.message : "codex binary check failed";
  }

  return { models: out, errors };
}

/**
 * Resolves an AI SDK `LanguageModel` for a cloud provider. Ollama is
 * intentionally handled out-of-band via `lib/ollama.ts` because the installed
 * `ollama-ai-provider@1.x` returns LanguageModelV1, which is incompatible with
 * the v6 `ai` package (expects LanguageModelV3).
 */
function resolveCloudModel(
  provider: Exclude<LlmProvider, "ollama" | "claude-code" | "codex">,
  model: string,
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(model);
    case "openai":
      return openai(model);
    case "google":
      return google(model);
  }
}

export async function llmGenerateOnce(opts: GenerateOpts): Promise<string> {
  if (opts.provider === "ollama") {
    return ollamaGenerateOnce({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      numCtx: opts.numCtx,
      signal: opts.signal,
    });
  }

  if (opts.provider === "claude-code") {
    return generateOnceClaudeCode({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      signal: opts.signal,
    });
  }

  if (opts.provider === "codex") {
    return generateOnceCodex({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      signal: opts.signal,
    });
  }

  const result = await generateText({
    model: resolveCloudModel(opts.provider, opts.model),
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature,
    abortSignal: opts.signal,
  });
  return result.text;
}

export async function* streamLlmGenerate(
  opts: GenerateOpts,
): AsyncGenerator<string, void, unknown> {
  if (opts.provider === "ollama") {
    yield* streamOllamaGenerate({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      numCtx: opts.numCtx,
      signal: opts.signal,
    });
    return;
  }

  if (opts.provider === "claude-code") {
    yield* streamClaudeCode({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      signal: opts.signal,
    });
    return;
  }

  if (opts.provider === "codex") {
    yield* streamCodex({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      signal: opts.signal,
    });
    return;
  }

  const result = streamText({
    model: resolveCloudModel(opts.provider, opts.model),
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature,
    abortSignal: opts.signal,
  });

  for await (const delta of result.textStream) {
    yield delta;
  }
}

// Re-exports for callers that want to detect provider-specific issues without
// importing several modules.
export {
  OllamaUnreachableError,
  OLLAMA_BASE_URL,
  ClaudeCodeMissingError,
  CodexMissingError,
};
