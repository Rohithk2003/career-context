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

export class ClaudeCodeMissingError extends Error {
  constructor() {
    super(
      "Claude Code CLI not found on PATH. Install with `npm i -g @anthropic-ai/claude-code` and run `claude /login` once.",
    );
    this.name = "ClaudeCodeMissingError";
  }
}

interface ClaudeCodeOpts {
  /** "sonnet" | "opus" | "haiku" or a full Anthropic model id the CLI accepts. */
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
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
  proc.stdin.write(opts.prompt);
  proc.stdin.end();

  // Buffer stdout into lines (JSONL) and emit deltas as they're parsed.
  let buffer = "";

  try {
    for await (const chunk of proc.stdout) {
      buffer += (chunk as Buffer).toString("utf-8");
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const delta = extractDeltaFromLine(line);
        if (delta) yield delta;
      }
    }
    // Drain any final partial line.
    if (buffer.trim()) {
      const delta = extractDeltaFromLine(buffer);
      if (delta) yield delta;
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
