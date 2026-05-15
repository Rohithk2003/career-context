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
  // `claude -p` reads the prompt from stdin when no positional arg is given.
  // We pass the prompt via stdin to avoid shell escaping issues.
  const args = ["-p", "--model", opts.model, "--output-format", "text"];
  if (opts.system) args.push("--system-prompt", opts.system);
  return args;
}

/**
 * Streams stdout from a `claude -p` subprocess. Each yielded string is whatever
 * Node delivers from the subprocess pipe — typically small chunks as the CLI
 * prints tokens. Aborts via `signal` send SIGTERM to the child.
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

  try {
    for await (const chunk of proc.stdout) {
      yield (chunk as Buffer).toString("utf-8");
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
