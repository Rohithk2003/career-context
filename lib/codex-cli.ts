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

export interface CodexUsage {
  inputTokens?: number;
  outputTokens?: number;
}

interface CodexOpts {
  /** Codex model id, e.g. "gpt-5-codex", "gpt-5". */
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
  /** Best-effort. The Codex CLI's stderr / stdout token-usage format isn't
   *  documented; this fires only if our pattern scanner finds something
   *  recognisable. Absence of usage is NOT an error. */
  onUsage?: (usage: CodexUsage) => void;
}

/** Scan a stderr buffer for token-usage hints. We don't have authoritative
 *  documentation of Codex's output format, so we try several common patterns
 *  observed in similar CLIs (line prefixes like "Tokens used:", JSON usage
 *  blobs, etc.) and return the first match. */
function tryExtractCodexUsage(text: string): CodexUsage | null {
  // Pattern A: "tokens used: input=12 output=34" / "Tokens: input 12 output 34"
  const a = text.match(
    /tokens?[^\n]*?input[^\d]*(\d+)[^\n]*?output[^\d]*(\d+)/i,
  );
  if (a) return { inputTokens: Number(a[1]), outputTokens: Number(a[2]) };

  // Pattern B: "prompt=12 completion=34" / "prompt tokens: 12, completion tokens: 34"
  const b = text.match(
    /prompt[^\d]*?(\d+)[\s\S]{0,80}?(?:completion|output)[^\d]*?(\d+)/i,
  );
  if (b) return { inputTokens: Number(b[1]), outputTokens: Number(b[2]) };

  // Pattern C: JSON line with a `usage` block (e.g. {"usage": {"input_tokens":12,"output_tokens":34}})
  const c = text.match(
    /"input_tokens"\s*:\s*(\d+)[\s\S]*?"output_tokens"\s*:\s*(\d+)/,
  );
  if (c) return { inputTokens: Number(c[1]), outputTokens: Number(c[2]) };

  return null;
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

  // Capture stdout into a running buffer too — Codex MIGHT emit usage on
  // stdout near the end of generation. We don't know for sure, so we scan
  // both stderr and stdout for any of our pattern matches when the process
  // exits.
  let stdoutBuf = "";

  proc.stdin.write(combinedPrompt(opts));
  proc.stdin.end();

  try {
    for await (const chunk of proc.stdout) {
      const text = (chunk as Buffer).toString("utf-8");
      stdoutBuf += text;
      yield text;
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
    if (opts.onUsage) {
      const usage =
        tryExtractCodexUsage(stderr) ?? tryExtractCodexUsage(stdoutBuf);
      if (usage) opts.onUsage(usage);
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
