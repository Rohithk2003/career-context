import { NextRequest } from "next/server";
import {
  streamLlmGenerate,
  isProviderConfigured,
  OllamaUnreachableError,
} from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { logRunAsync } from "@/lib/runs-log";
import type { LlmProvider } from "@/lib/types";
import { truncate } from "@/lib/utils";

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

interface ImproveContextBody {
  provider?: string;
  model?: string;
  currentContext?: string;
  instruction?: string;
  history?: Array<{ role?: string; content?: string }>;
}

type StageEvent =
  | { type: "stage"; stage: string; status: "start" | "done" }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

function sseEncode(ev: StageEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: ImproveContextBody["history"]): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const turn of raw) {
    if (!turn || typeof turn !== "object") continue;
    const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : null;
    const content = typeof turn.content === "string" ? turn.content : null;
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

function buildImprovePrompt(args: {
  currentContext: string;
  instruction: string;
  history: ChatTurn[];
}): string {
  const { currentContext, instruction, history } = args;

  // Keep the last 6 turns to bound context size.
  const recent = history.slice(-6);
  const historyBlock = recent.length
    ? recent
        .map((t, i) => {
          const tag = t.role === "user" ? "USER" : "ASSISTANT";
          // Assistant turns are revisions — they can be long. Compress hard.
          const body =
            t.role === "assistant"
              ? truncate(t.content, 600)
              : truncate(t.content, 1_200);
          return `[${i + 1}] ${tag}: ${body}`;
        })
        .join("\n\n")
    : "(no prior turns)";

  return `REVISION PASS — IMPROVE EXISTING CAREER CONTEXT PROFILE

You are revising a previously generated Career Context Profile. Apply the user's latest instruction faithfully while preserving the structure and any facts that the user did not ask to change.

HARD RULES
- Return a COMPLETE revised Markdown profile. Do NOT return only a diff or only the changed section.
- Preserve the EXACT top-level section headings (\`## ...\`) from the previous profile, in the same order. Do not drop, rename, merge, or add top-level sections.
- Apply the user's instruction faithfully. If it conflicts with a hard rule (e.g. they ask you to invent experience), follow the hard rule and note the limitation briefly inside the relevant section.
- Do NOT invent new factual claims (employers, dates, projects, metrics) beyond what was already present in the previous profile or earlier turns. You may rephrase, reframe, expand inference, or shift emphasis.
- Keep \`(inferred: ...)\` / \`(confidence: ...)\` / \`(github)\` / \`(resume)\` / \`(both)\` tagging conventions where they already exist.
- No preamble. Start directly with the first \`## \` heading. No "Here is the revised profile" framing, no trailing commentary.

---PRIOR CONVERSATION (most recent turns, oldest first)---
${historyBlock}
---END PRIOR CONVERSATION---

---CURRENT PROFILE (Markdown)---
${currentContext}
---END CURRENT PROFILE---

---NEW USER INSTRUCTION---
${instruction}
---END INSTRUCTION---

Now produce the revised full Markdown profile.`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ImproveContextBody;
  const providerRaw = body.provider?.trim();
  const model = body.model?.trim();
  const currentContext = body.currentContext?.trim() || "";
  const instruction = body.instruction?.trim() || "";
  const history = sanitizeHistory(body.history);

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

  if (!currentContext) {
    return new Response(
      JSON.stringify({
        error:
          "Current context is required. Generate the profile first, then refine it.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!instruction) {
    return new Response(
      JSON.stringify({ error: "Instruction is required." }),
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
        send({
          type: "stage",
          stage: "Revising career context",
          status: "start",
        });
        const prompt = buildImprovePrompt({
          currentContext,
          instruction,
          history,
        });

        for await (const chunk of streamLlmGenerate({
          provider,
          model,
          system: SYSTEM_PROMPT,
          prompt,
          temperature: 0.4,
          numCtx: 12_288,
          signal,
        })) {
          finalOutput += chunk;
          send({ type: "delta", text: chunk });
        }
        send({
          type: "stage",
          stage: "Revising career context",
          status: "done",
        });
        send({ type: "done" });
      } catch (err) {
        const msg =
          err instanceof OllamaUnreachableError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error during context revision";
        runError = msg;
        send({ type: "error", message: msg });
      } finally {
        logRunAsync({
          kind: "improve-context",
          provider,
          model,
          durationMs: Date.now() - startedAt,
          inputs: {
            instruction,
            historyTurns: history.length,
            contextChars: currentContext.length,
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
