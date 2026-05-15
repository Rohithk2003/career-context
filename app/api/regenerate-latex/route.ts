import { NextRequest, NextResponse } from "next/server";
import { llmGenerateOnce, OllamaUnreachableError } from "@/lib/llm";
import { buildLatexRegenPrompt } from "@/lib/latex-prompts";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { logRunAsync, makeUsageAccumulator } from "@/lib/runs-log";
import type { LlmProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RegenerateLatexBody {
  provider?: LlmProvider;
  model?: string;
  originalTex?: string;
  jobDescription?: string | null;
  careerContext?: string | null;
}

/**
 * Strip markdown code fences the LLM may have wrapped the response in.
 * Handles:
 *   ```latex\n...\n```
 *   ```tex\n...\n```
 *   ```\n...\n```
 * Also trims leading "Here is..." preamble up to the first \documentclass.
 */
function stripFences(raw: string): string {
  let s = raw.trim();

  // Drop a leading fence block opener (with optional language tag).
  const fenceOpen = /^```[a-zA-Z]*\s*\n?/;
  if (fenceOpen.test(s)) s = s.replace(fenceOpen, "");

  // Drop a trailing fence.
  s = s.replace(/\n?```\s*$/, "");

  // If the model still prepended commentary, slice from the first
  // \documentclass occurrence forward. Common offender: "Here is the tailored
  // resume:\n\n\\documentclass{...}".
  const docIdx = s.indexOf("\\documentclass");
  if (docIdx > 0) s = s.slice(docIdx);

  // Trim trailing junk after \end{document} (sometimes models add "Hope this helps!").
  const endIdx = s.indexOf("\\end{document}");
  if (endIdx !== -1) {
    s = s.slice(0, endIdx + "\\end{document}".length);
  }

  return s.trim();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RegenerateLatexBody;
  const provider = body.provider;
  const model = body.model?.trim();
  const originalTex = body.originalTex?.trim();
  const jobDescription = body.jobDescription?.trim() || null;
  const careerContext = body.careerContext?.trim() || null;

  if (!provider || !model) {
    return NextResponse.json(
      { error: "Provider and model are required." },
      { status: 400 },
    );
  }
  if (!originalTex) {
    return NextResponse.json(
      { error: "originalTex is required (raw LaTeX source of the resume)." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const inputs = {
    originalTexChars: originalTex.length,
    jobDescriptionChars: jobDescription?.length ?? 0,
    careerContextChars: careerContext?.length ?? 0,
  };
  const { onUsage, snapshot: usageSnapshot } = makeUsageAccumulator();

  try {
    const prompt = buildLatexRegenPrompt({
      originalTex,
      jobDescription,
      careerContext,
    });

    const raw = await llmGenerateOnce({
      provider,
      model,
      system: SYSTEM_PROMPT,
      prompt,
      // Slightly lower temperature than the synthesis pass — we want faithful,
      // structurally correct LaTeX, not creative riffs.
      temperature: 0.3,
      numCtx: 16_384,
      signal: req.signal,
      onUsage,
    });

    const latex = stripFences(raw);

    if (!latex.startsWith("\\documentclass")) {
      logRunAsync({
        kind: "resume-latex",
        provider,
        model,
        durationMs: Date.now() - startedAt,
        inputs,
        output: null,
        error: "Model did not return a valid LaTeX document",
        usage: usageSnapshot(),
      });
      return NextResponse.json(
        {
          error:
            "Model did not return a valid LaTeX document — output did not start with \\documentclass. Try a different model or retry.",
          rawPreview: raw.slice(0, 400),
        },
        { status: 502 },
      );
    }

    logRunAsync({
      kind: "resume-latex",
      provider,
      model,
      durationMs: Date.now() - startedAt,
      inputs,
      output: latex,
      usage: usageSnapshot(),
    });
    return NextResponse.json({ latex });
  } catch (err) {
    const msg =
      err instanceof OllamaUnreachableError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to regenerate LaTeX.";
    logRunAsync({
      kind: "resume-latex",
      provider,
      model,
      durationMs: Date.now() - startedAt,
      inputs,
      output: null,
      error: msg,
      usage: usageSnapshot(),
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
