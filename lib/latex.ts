/**
 * Lightweight LaTeX → plain text extractor tuned for résumés (moderncv, awesome-cv,
 * resume.cls, the typical hand-rolled `\section{}` + `\item` style).
 *
 * Goals:
 *   - keep section names, bullet items, names, dates, and link URLs
 *   - drop preamble, comments, packages, layout commands
 *   - normalise LaTeX escapes (\&, \%, \$, \_, \#, ~, ---, --)
 *   - strip remaining `\foo{...}` and `\foo[...]{...}` while keeping the inner text
 *
 * This is deliberately not a full TeX parser — résumés use a tiny subset and
 * pulling a real one in would be massive overkill.
 */

// Commands that should be dropped wholesale, including their argument(s).
const DROP_CMDS = new Set([
  "documentclass",
  "usepackage",
  "input",
  "include",
  "geometry",
  "pagestyle",
  "thispagestyle",
  "setlength",
  "renewcommand",
  "newcommand",
  "providecommand",
  "definecolor",
  "color",
  "colorbox",
  "fontsize",
  "selectfont",
  "hypersetup",
  "addtolength",
  "vspace",
  "hspace",
  "vfill",
  "hfill",
  "vskip",
  "hskip",
  "noindent",
  "centering",
  "raggedright",
  "raggedleft",
  "raggedbottom",
  "raggedcolumns",
  "linespread",
  "small",
  "footnotesize",
  "scriptsize",
  "tiny",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
  "label",
  "ref",
  "cite",
  "bibliography",
  "bibliographystyle",
  "maketitle",
  "tableofcontents",
  "newpage",
  "clearpage",
  "pagebreak",
  "columnbreak",
  "addcontentsline",
  "fancyhead",
  "fancyfoot",
  "fancyhf",
  "renewcommand*",
  "setmainfont",
  "setsansfont",
  "setmonofont",
  "moderncvtheme",
  "moderncvstyle",
  "moderncvcolor",
  "name",
  "address",
  "phone",
  "email",
  "homepage",
  "social",
  "photo",
  "extrainfo",
  "quote",
]);

// Commands whose first {arg} should be rendered as a heading on its own line.
const HEADING_CMDS = new Set([
  "section",
  "section*",
  "subsection",
  "subsection*",
  "subsubsection",
  "subsubsection*",
  "paragraph",
  "cvsection",
  "resumeSection",
  "resumesection",
  "resumeSubheading",
  "resumeProjectHeading",
]);

// Commands whose arguments are concatenated with " — " or " · " separators
// (typical moderncv / awesome-cv entry macros).
const ENTRY_CMDS: Record<string, string> = {
  cventry: " — ",
  cvitem: ": ",
  cvitemwithcomment: " — ",
  cvlistitem: "- ",
  cvlistdoubleitem: "- ",
  cvline: ": ",
  cvdoubleitem: " — ",
  cvlanguage: " — ",
  cvcomputer: " — ",
  resumeSubheading: " — ",
  resumeProjectHeading: " — ",
  resumeItem: "- ",
  resumeSubItem: "  - ",
};

// Inline commands that keep their {arg} text but no formatting.
const INLINE_KEEP = new Set([
  "textbf",
  "textit",
  "emph",
  "underline",
  "textsl",
  "textsc",
  "texttt",
  "textnormal",
  "mbox",
  "url",
  "href", // \href{url}{text} — handled specially
  "textcolor",
  "colorbox",
  "fbox",
  "framebox",
  "uppercase",
  "lowercase",
  "MakeUppercase",
  "MakeLowercase",
]);

// LaTeX escape replacements (run after command stripping).
const ESCAPE_MAP: Array<[RegExp, string]> = [
  [/\\&/g, "&"],
  [/\\%/g, "%"],
  [/\\\$/g, "$"],
  [/\\#/g, "#"],
  [/\\_/g, "_"],
  [/\\\{/g, "{"],
  [/\\\}/g, "}"],
  [/\\textbackslash\s*\{\}/g, "\\"],
  [/\\textbackslash\b/g, "\\"],
  [/~/g, " "],
  [/---/g, "—"],
  [/--/g, "–"],
  [/``/g, "“"],
  [/''/g, "”"],
  [/\\quad\b/g, "  "],
  [/\\qquad\b/g, "    "],
  [/\\\\(\s*\[[^\]]*\])?/g, "\n"],
  [/\\,/g, " "],
  [/\\ /g, " "],
  [/\\@/g, ""],
  [/\\LaTeX\b/g, "LaTeX"],
  [/\\TeX\b/g, "TeX"],
];

interface ParseCtx {
  src: string;
  i: number;
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z@*]/.test(ch);
}

function readCommandName(ctx: ParseCtx): string {
  // ctx.i points at the char after the backslash
  let name = "";
  while (ctx.i < ctx.src.length && isWordChar(ctx.src[ctx.i])) {
    name += ctx.src[ctx.i];
    ctx.i++;
  }
  if (name === "" && ctx.i < ctx.src.length) {
    // single non-letter command like \\, \&, \%, \_  — caller handles
    name = ctx.src[ctx.i];
    ctx.i++;
  }
  return name;
}

function skipWhitespace(ctx: ParseCtx) {
  while (ctx.i < ctx.src.length && /\s/.test(ctx.src[ctx.i])) ctx.i++;
}

function readBracketArg(ctx: ParseCtx): string | null {
  skipWhitespace(ctx);
  if (ctx.src[ctx.i] !== "[") return null;
  ctx.i++; // consume [
  let depth = 1;
  let out = "";
  while (ctx.i < ctx.src.length && depth > 0) {
    const ch = ctx.src[ctx.i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        ctx.i++;
        return out;
      }
    }
    out += ch;
    ctx.i++;
  }
  return out;
}

function readBraceArg(ctx: ParseCtx): string | null {
  skipWhitespace(ctx);
  if (ctx.src[ctx.i] !== "{") return null;
  ctx.i++; // consume {
  let depth = 1;
  let out = "";
  while (ctx.i < ctx.src.length && depth > 0) {
    const ch = ctx.src[ctx.i];
    if (ch === "\\" && ctx.i + 1 < ctx.src.length) {
      // skip escaped char so we don't miscount braces
      out += ch + ctx.src[ctx.i + 1];
      ctx.i += 2;
      continue;
    }
    if (ch === "{") {
      depth++;
      out += ch;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        ctx.i++;
        return out;
      }
      out += ch;
    } else {
      out += ch;
    }
    ctx.i++;
  }
  return out;
}

function readAllBraceArgs(ctx: ParseCtx): string[] {
  const args: string[] = [];
  // also consume any optional [..] arg first
  while (true) {
    const savedI = ctx.i;
    skipWhitespace(ctx);
    if (ctx.src[ctx.i] === "[") {
      readBracketArg(ctx);
      continue;
    }
    if (ctx.src[ctx.i] === "{") {
      const a = readBraceArg(ctx);
      if (a !== null) {
        args.push(a);
        continue;
      }
    }
    ctx.i = savedI;
    break;
  }
  return args;
}

function processNode(src: string): string {
  const ctx: ParseCtx = { src, i: 0 };
  let out = "";

  while (ctx.i < ctx.src.length) {
    const ch = ctx.src[ctx.i];

    if (ch === "%") {
      // line comment to end of line (skip newline too to avoid double-blanking)
      while (ctx.i < ctx.src.length && ctx.src[ctx.i] !== "\n") ctx.i++;
      continue;
    }

    if (ch === "\\") {
      ctx.i++;
      const name = readCommandName(ctx);

      // Begin/end environments
      if (name === "begin" || name === "end") {
        const envName = readBraceArg(ctx) ?? "";
        // Drop math + verbatim + tabular env contents wholesale
        if (
          name === "begin" &&
          /^(equation|align|gather|multline|verbatim|lstlisting|minted|tikzpicture|figure)\*?$/.test(
            envName,
          )
        ) {
          // skip until matching \end{envName}
          const closing = `\\end{${envName}}`;
          const idx = ctx.src.indexOf(closing, ctx.i);
          ctx.i = idx === -1 ? ctx.src.length : idx + closing.length;
          continue;
        }
        if (name === "begin" && /^(itemize|enumerate|description)$/.test(envName)) {
          out += "\n";
          continue;
        }
        if (name === "end" && /^(itemize|enumerate|description)$/.test(envName)) {
          out += "\n";
          continue;
        }
        // also consume any optional [..] arg the env may carry
        readBracketArg(ctx);
        continue;
      }

      if (name === "item") {
        // optional [..] label
        const label = readBracketArg(ctx);
        out += `\n- ${label ? label + " " : ""}`;
        continue;
      }

      if (name === "href") {
        const url = readBraceArg(ctx) ?? "";
        const text = readBraceArg(ctx) ?? "";
        out += text ? `${processNode(text)} (${url})` : url;
        continue;
      }

      if (HEADING_CMDS.has(name)) {
        readBracketArg(ctx); // optional short title
        const arg = readBraceArg(ctx) ?? "";
        out += `\n\n## ${processNode(arg).trim()}\n`;
        continue;
      }

      if (ENTRY_CMDS[name] !== undefined) {
        const sep = ENTRY_CMDS[name];
        const args = readAllBraceArgs(ctx);
        const flat = args
          .map((a) => processNode(a).trim())
          .filter(Boolean)
          .join(sep);
        out += `\n${flat}`;
        continue;
      }

      if (INLINE_KEEP.has(name)) {
        // consume optional [..] args first
        readBracketArg(ctx);
        const arg = readBraceArg(ctx);
        if (arg !== null) out += processNode(arg);
        continue;
      }

      if (DROP_CMDS.has(name)) {
        // consume optional [..] + one or two {..} args greedily
        readAllBraceArgs(ctx);
        continue;
      }

      // Unknown command: keep its arg text but drop the command itself.
      const args = readAllBraceArgs(ctx);
      if (args.length > 0) {
        out += args.map((a) => processNode(a)).join(" ");
      }
      continue;
    }

    if (ch === "{" || ch === "}") {
      // bare braces — usually grouping for fonts; ignore them
      ctx.i++;
      continue;
    }

    if (ch === "$") {
      // skip inline math
      ctx.i++;
      while (ctx.i < ctx.src.length && ctx.src[ctx.i] !== "$") {
        if (ctx.src[ctx.i] === "\\" && ctx.i + 1 < ctx.src.length) ctx.i++;
        ctx.i++;
      }
      ctx.i++; // closing $
      continue;
    }

    out += ch;
    ctx.i++;
  }

  return out;
}

function applyEscapes(s: string): string {
  let out = s;
  for (const [re, rep] of ESCAPE_MAP) out = out.replace(re, rep);
  return out;
}

export function latexToPlainText(source: string): string {
  // Trim preamble: everything before \begin{document} (if present)
  let body = source;
  const docStart = source.indexOf("\\begin{document}");
  if (docStart !== -1) body = source.slice(docStart + "\\begin{document}".length);
  const docEnd = body.indexOf("\\end{document}");
  if (docEnd !== -1) body = body.slice(0, docEnd);

  const processed = processNode(body);
  const escaped = applyEscapes(processed);
  // Collapse 3+ blank lines, trim trailing spaces on each line
  return escaped
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// LaTeX detection + compile helpers (used by the regen / compile API routes).
// These are intentionally separate from the plain-text extractor above so the
// extractor stays free of Node-specific imports and can be used in any runtime.
// ---------------------------------------------------------------------------

/**
 * Cheap heuristic — does this string look like a LaTeX document?
 * Looks for either the `\documentclass` directive or a `\begin{document}` body
 * marker. We don't need to be exhaustive; the upstream code already detected
 * file extension. This is a belt-and-braces sanity check.
 */
export function isLikelyLatex(text: string): boolean {
  if (!text) return false;
  return /\\documentclass\b/.test(text) || /\\begin\{document\}/.test(text);
}

export class LatexToolchainMissingError extends Error {
  constructor(
    message = "No LaTeX toolchain found. Install `tectonic` (brew install tectonic) or a TeX Live distribution that provides `pdflatex`.",
  ) {
    super(message);
    this.name = "LatexToolchainMissingError";
  }
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runSpawn(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<SpawnResult> {
  const { spawn } = await import("node:child_process");
  return new Promise<SpawnResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function which(cmd: string): Promise<boolean> {
  try {
    const res = await runSpawn(
      process.platform === "win32" ? "where" : "which",
      [cmd],
      process.cwd(),
    );
    return res.code === 0;
  } catch {
    return false;
  }
}

/**
 * Compile a LaTeX document to PDF.
 *
 * Strategy:
 *   1. Prefer `tectonic` — it's a single static binary with no system
 *      dependencies and auto-fetches missing packages.
 *   2. Fall back to `pdflatex` (run twice for refs) if tectonic isn't on PATH.
 *   3. Throw `LatexToolchainMissingError` if neither exists.
 *
 * Compilation happens inside a unique temp dir so concurrent calls don't
 * collide. The temp dir is always cleaned up, even on failure.
 */
export async function compileLatexToPdf(tex: string): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  const hasTectonic = await which("tectonic");
  const hasPdflatex = hasTectonic ? false : await which("pdflatex");
  if (!hasTectonic && !hasPdflatex) {
    throw new LatexToolchainMissingError();
  }

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "career-latex-"));
  const texPath = path.join(tmpRoot, "resume.tex");
  const pdfPath = path.join(tmpRoot, "resume.pdf");

  try {
    await fs.writeFile(texPath, tex, "utf-8");

    if (hasTectonic) {
      const res = await runSpawn(
        "tectonic",
        [
          "--keep-logs",
          "--outdir",
          tmpRoot,
          "--chatter",
          "minimal",
          texPath,
        ],
        tmpRoot,
      );
      if (res.code !== 0) {
        throw new Error(
          `tectonic exited with code ${res.code}.\n${res.stderr || res.stdout}`.slice(
            0,
            4000,
          ),
        );
      }
    } else {
      // pdflatex: run twice so cross-refs resolve. -interaction=nonstopmode
      // ensures the process exits on errors rather than waiting for stdin.
      const args = [
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-output-directory",
        tmpRoot,
        texPath,
      ];
      for (let pass = 0; pass < 2; pass++) {
        const res = await runSpawn("pdflatex", args, tmpRoot);
        if (res.code !== 0) {
          throw new Error(
            `pdflatex (pass ${pass + 1}) exited with code ${res.code}.\n${
              res.stdout || res.stderr
            }`.slice(0, 4000),
          );
        }
      }
    }

    const pdf = await fs.readFile(pdfPath);
    return pdf;
  } finally {
    // Best-effort cleanup. Don't let a stuck file handle mask the real error.
    fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
