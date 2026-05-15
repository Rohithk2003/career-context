import type { OllamaModel } from "./types";

export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:11434";

export class OllamaUnreachableError extends Error {
  constructor(message = "Ollama is not reachable") {
    super(message);
    this.name = "OllamaUnreachableError";
  }
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      cache: "no-store",
    });
  } catch (err) {
    throw new OllamaUnreachableError(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Is the daemon running? (\`ollama serve\`)`,
    );
  }
  if (!res.ok) {
    throw new Error(`Ollama /api/tags returned ${res.status}`);
  }
  const data = (await res.json()) as { models?: OllamaModel[] };
  return (data.models ?? []).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

export interface OllamaUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalDurationMs?: number;
  evalDurationMs?: number;
  promptEvalDurationMs?: number;
}

interface GenerateOptions {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  numCtx?: number;
  signal?: AbortSignal;
  onUsage?: (usage: OllamaUsage) => void;
}

function nsToMs(ns: number | undefined): number | undefined {
  if (typeof ns !== "number" || !Number.isFinite(ns) || ns < 0) return undefined;
  return Math.round(ns / 1_000_000);
}

/**
 * Streams Ollama /api/generate as plain text deltas. Yields each token chunk
 * as it arrives so callers can pipe directly to a Response stream.
 */
export async function* streamOllamaGenerate(
  opts: GenerateOptions,
): AsyncGenerator<string, void, unknown> {
  const body = {
    model: opts.model,
    prompt: opts.prompt,
    system: opts.system,
    stream: true,
    options: {
      temperature: opts.temperature ?? 0.4,
      num_ctx: opts.numCtx ?? 8192,
    },
  };

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    throw new OllamaUnreachableError(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}.`,
    );
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama /api/generate ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            const evt = JSON.parse(line) as {
              response?: string;
              done?: boolean;
              error?: string;
              prompt_eval_count?: number;
              eval_count?: number;
              total_duration?: number;
              eval_duration?: number;
              prompt_eval_duration?: number;
            };
            if (evt.error) throw new Error(evt.error);
            if (evt.response) yield evt.response;
            if (evt.done) {
              if (opts.onUsage) {
                opts.onUsage({
                  inputTokens: evt.prompt_eval_count,
                  outputTokens: evt.eval_count,
                  totalDurationMs: nsToMs(evt.total_duration),
                  evalDurationMs: nsToMs(evt.eval_duration),
                  promptEvalDurationMs: nsToMs(evt.prompt_eval_duration),
                });
              }
              return;
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes("Unexpected")) {
              // partial line - put back and wait for more
              buffer = line + "\n" + buffer;
              break;
            }
            throw e;
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming convenience for the layered prompt steps that the orchestrator
 * uses internally before emitting the final synthesis.
 */
export async function ollamaGenerateOnce(
  opts: GenerateOptions,
): Promise<string> {
  let out = "";
  for await (const chunk of streamOllamaGenerate(opts)) out += chunk;
  return out;
}
