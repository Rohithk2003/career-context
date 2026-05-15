import "server-only";
import { spawn } from "node:child_process";

let cachedBinaryPath: string | null | undefined;

async function locateClaudeBinary(): Promise<string | null> {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  cachedBinaryPath = await new Promise<string | null>((resolve) => {
    const p = spawn("which", ["claude"]);
    let buf = "";
    p.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
    });
    p.on("close", (code) => {
      if (code === 0 && buf.trim()) resolve(buf.trim().split("\n")[0]);
      else resolve(null);
    });
    p.on("error", () => resolve(null));
  });
  return cachedBinaryPath;
}

export async function isClaudeCodeAvailable(): Promise<boolean> {
  return (await locateClaudeBinary()) !== null;
}

let cachedSkills: string[] | null = null;

/**
 * List installed Claude Code skills (built-ins + plugin-supplied) by
 * spawning `claude -p` just long enough to read the `system init` JSON line,
 * which authoritatively enumerates the active skill set. Kills the process
 * before any API call goes out, so this is effectively free of tokens.
 *
 * Returns [] if the binary isn't installed or the init line doesn't arrive
 * within 15s. Cached for the Node process lifetime — restart the server to
 * pick up newly-installed skills.
 */
export async function listClaudeCodeSkills(): Promise<string[]> {
  if (cachedSkills) return cachedSkills;
  const bin = await locateClaudeBinary();
  if (!bin) {
    cachedSkills = [];
    return cachedSkills;
  }

  return new Promise<string[]>((resolve) => {
    const proc = spawn(
      bin,
      [
        "-p",
        "--model",
        "haiku",
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let buffer = "";
    let resolved = false;
    const finish = (result: string[]) => {
      if (resolved) return;
      resolved = true;
      cachedSkills = result;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    proc.stdout.on("data", (d: Buffer) => {
      buffer += d.toString("utf-8");
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const obj = JSON.parse(line.trim() || "null") as Record<
            string,
            unknown
          > | null;
          if (
            obj &&
            obj.type === "system" &&
            obj.subtype === "init" &&
            Array.isArray(obj.skills)
          ) {
            const skills = (obj.skills as unknown[]).filter(
              (s): s is string => typeof s === "string",
            );
            finish(skills);
            return;
          }
        } catch {
          /* not json — keep buffering */
        }
      }
    });

    proc.on("error", () => finish([]));
    proc.on("close", () => finish([]));

    // The CLI doesn't emit `init` until stdin is closed. Send a no-op
    // single-space prompt and close — that's enough to trigger init.
    proc.stdin.write(" ");
    proc.stdin.end();

    // Safety fallback if init never arrives.
    setTimeout(() => finish([]), 15_000);
  });
}

export class ClaudeCodeMissingError extends Error {
  constructor() {
    super(
      "Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` and run `claude /login` once.",
    );
    this.name = "ClaudeCodeMissingError";
  }
}

export interface ClaudeCodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd?: number;
}

interface ClaudeCodeOpts {
  /** "sonnet" | "opus" | "haiku" or a full Anthropic model id the CLI accepts. */
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
  /** Called once when the CLI's final `result` event arrives. */
  onUsage?: (usage: ClaudeCodeUsage) => void;
  /** Names of Claude Code skills to invoke (as `/skill-name` lines prepended
   *  to the prompt). The CLI resolves each slash command itself. Order is
   *  preserved. Invalid skill names are silently ignored by the CLI. */
  skills?: string[];
}

/** Prepend `/skill-name` invocation lines to the prompt so the CLI fires
 *  the matching skills before processing the user message. Each on its own
 *  line. Returns the prompt unchanged when no skills are supplied. */
function applySkillsToPrompt(prompt: string, skills: string[] | undefined): string {
  if (!skills || skills.length === 0) return prompt;
  // Filter to safe slash-command shapes: kebab/snake/dot/colon allowed, no spaces.
  const safe = skills.filter((s) => /^[A-Za-z0-9_:./-]+$/.test(s));
  if (safe.length === 0) return prompt;
  const header = safe.map((s) => `/${s}`).join("\n");
  return `${header}\n\n${prompt}`;
}

function buildArgs(opts: ClaudeCodeOpts): string[] {
  // Critical flags:
  //   --output-format stream-json + --include-partial-messages + --verbose
  //     gives us real token-level streaming. The default "text" output mode
  //     BUFFERS the entire response until completion — from the user's POV
  //     that looks like the app hangs for the full generation duration with
  //     no progress, then dumps everything at once.
  //
  //   We deliberately do NOT pass --bare here even though it would skip the
  //   per-invocation CLAUDE.md / hooks / LSP / plugin-sync overhead, because
  //   --bare also disables keychain auth reads. Users who authenticated via
  //   `claude /login` (the supported path for the subscription tier) keep
  //   their credentials in the keychain, and --bare reports them as logged
  //   out. The streaming win alone is the biggest UX gain.
  const args = [
    "-p",
    "--model",
    opts.model,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
  if (opts.system) args.push("--system-prompt", opts.system);
  return args;
}

/** Extract a text delta from a single line of `--output-format stream-json`.
 *  The CLI emits one JSON object per line. We only listen for partial
 *  `content_block_delta` events with type `text_delta` — that's where the
 *  actual streaming tokens land when `--include-partial-messages` is on.
 *
 *  The CLI also emits a final non-partial `assistant` event containing the
 *  full text once the message completes. We deliberately ignore that here,
 *  otherwise we'd double-emit (delta stream + full message = each token
 *  yielded twice). All other event kinds (system hooks, rate-limit, tool
 *  events, result, etc.) are also intentionally ignored. */
function extractDeltaFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const ev = obj as Record<string, unknown>;

  if (ev.type !== "stream_event" || !ev.event || typeof ev.event !== "object") {
    return null;
  }
  const inner = ev.event as Record<string, unknown>;
  if (inner.type !== "content_block_delta" || !inner.delta) return null;
  const d = inner.delta as Record<string, unknown>;
  if (d.type === "text_delta" && typeof d.text === "string") return d.text;
  return null;
}

/** Extract token usage from the CLI's final `result` event. Returns null
 *  for any other event type. The `result` event arrives once at the end of
 *  a generation and is the authoritative usage record. */
function extractUsageFromLine(line: string): ClaudeCodeUsage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const ev = obj as Record<string, unknown>;
  if (ev.type !== "result") return null;
  const usage = (ev.usage as Record<string, unknown>) || {};
  const u: ClaudeCodeUsage = {};
  if (typeof usage.input_tokens === "number")
    u.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number")
    u.outputTokens = usage.output_tokens;
  if (typeof usage.cache_creation_input_tokens === "number")
    u.cacheCreationInputTokens = usage.cache_creation_input_tokens;
  if (typeof usage.cache_read_input_tokens === "number")
    u.cacheReadInputTokens = usage.cache_read_input_tokens;
  if (typeof ev.total_cost_usd === "number") u.costUsd = ev.total_cost_usd;
  return u;
}

/**
 * Streams stdout from a `claude -p` subprocess as text deltas. Aborts via
 * `signal` send SIGTERM to the child.
 */
export async function* streamClaudeCode(
  opts: ClaudeCodeOpts,
): AsyncGenerator<string, void, unknown> {
  const bin = await locateClaudeBinary();
  if (!bin) throw new ClaudeCodeMissingError();

  const proc = spawn(bin, buildArgs(opts), { stdio: ["pipe", "pipe", "pipe"] });
  const onAbort = () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener("abort", onAbort);

  let stderr = "";
  proc.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });

  // Pipe the prompt into stdin and close.
  proc.stdin.write(applySkillsToPrompt(opts.prompt, opts.skills));
  proc.stdin.end();

  // Buffer stdout into lines (JSONL) and emit deltas as they're parsed.
  let buffer = "";
  let usageFired = false;

  try {
    for await (const chunk of proc.stdout) {
      buffer += (chunk as Buffer).toString("utf-8");
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const delta = extractDeltaFromLine(line);
        if (delta) yield delta;
        if (!usageFired && opts.onUsage) {
          const usage = extractUsageFromLine(line);
          if (usage) {
            usageFired = true;
            opts.onUsage(usage);
          }
        }
      }
    }
    // Drain any final partial line.
    if (buffer.trim()) {
      const delta = extractDeltaFromLine(buffer);
      if (delta) yield delta;
      if (!usageFired && opts.onUsage) {
        const usage = extractUsageFromLine(buffer);
        if (usage) {
          usageFired = true;
          opts.onUsage(usage);
        }
      }
    }
    const code: number | null = await new Promise((resolve) => {
      proc.on("close", resolve);
    });
    if (code !== 0) {
      const tail = stderr.trim().slice(-400);
      throw new Error(
        tail
          ? `claude exited with code ${code}: ${tail}`
          : `claude exited with code ${code}`,
      );
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function generateOnceClaudeCode(
  opts: ClaudeCodeOpts,
): Promise<string> {
  let out = "";
  for await (const chunk of streamClaudeCode(opts)) out += chunk;
  return out.trim();
}
