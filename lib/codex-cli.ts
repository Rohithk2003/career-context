import "server-only";
import { spawn } from "node:child_process";

let cachedBinaryPath: string | null | undefined;

async function locateCodexBinary(): Promise<string | null> {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  cachedBinaryPath = await new Promise<string | null>((resolve) => {
    const p = spawn("which", ["codex"]);
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

export async function isCodexAvailable(): Promise<boolean> {
  return (await locateCodexBinary()) !== null;
}

export class CodexMissingError extends Error {
  constructor() {
    super(
      "Codex CLI not found on PATH. Install with `npm i -g @openai/codex` and run `codex login` once.",
    );
    this.name = "CodexMissingError";
  }
}

interface CodexOpts {
  /** Codex model id, e.g. "gpt-5-codex", "gpt-5". */
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
}

function buildArgs(opts: CodexOpts): string[] {
  // `codex exec` runs one-shot non-interactive. Model via -m. We disable the
  // git-repo-check because this app may run from a non-git working dir.
  return ["exec", "-m", opts.model, "--skip-git-repo-check"];
}

/** Codex has no `--system-prompt` flag, so we prepend the system instruction. */
function combinedPrompt(opts: CodexOpts): string {
  if (!opts.system) return opts.prompt;
  return `${opts.system}\n\n---\n\n${opts.prompt}`;
}

export async function* streamCodex(
  opts: CodexOpts,
): AsyncGenerator<string, void, unknown> {
  const bin = await locateCodexBinary();
  if (!bin) throw new CodexMissingError();

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

  proc.stdin.write(combinedPrompt(opts));
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
          ? `codex exited with code ${code}: ${tail}`
          : `codex exited with code ${code}`,
      );
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function generateOnceCodex(opts: CodexOpts): Promise<string> {
  let out = "";
  for await (const chunk of streamCodex(opts)) out += chunk;
  return out.trim();
}
