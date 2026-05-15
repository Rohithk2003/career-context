import { truncate } from "./utils";

interface BuildLatexRegenPromptArgs {
  originalTex: string;
  jobDescription?: string | null;
  careerContext?: string | null;
}

/**
 * Build the prompt that asks the LLM to rewrite an existing LaTeX résumé,
 * tailored to a specific job description and grounded in the synthesised
 * career-context profile.
 *
 * Hard constraints embedded in the prompt:
 *   - The output MUST be a complete, compilable LaTeX document.
 *   - Same packages / preamble / layout as the original — we are tailoring
 *     content, not redesigning the resume.
 *   - No code fences, no commentary, no preamble like "Here is...".
 *   - Never invent employers, degrees, dates, or metrics that aren't in the
 *     original tex or the career context.
 */
export function buildLatexRegenPrompt(args: BuildLatexRegenPromptArgs): string {
  const { originalTex, jobDescription, careerContext } = args;

  const jdBlock = jobDescription?.trim()
    ? `\n---TARGET JOB DESCRIPTION---\n${truncate(jobDescription.trim(), 8_000)}\n---END JD---\n`
    : "\n(No job description provided — keep content faithful to the original; only tighten phrasing.)\n";

  const ccBlock = careerContext?.trim()
    ? `\n---CAREER CONTEXT PROFILE---\n${truncate(careerContext.trim(), 8_000)}\n---END CONTEXT---\n`
    : "\n(No career-context profile provided — rely solely on the original tex.)\n";

  // We deliberately give the LLM the full original tex (truncated only if huge)
  // so it can preserve the user's hand-crafted macros, spacing, and styling.
  const texBlock = `\n---ORIGINAL LATEX SOURCE---\n${truncate(originalTex, 30_000)}\n---END LATEX---\n`;

  return `You are rewriting a LaTeX résumé to better align with a target role.

GOAL
Produce a complete, valid LaTeX document that is a *tailored* version of the original. Same packages, same document class, same custom commands, same overall layout and section order. You are editing CONTENT — never redesigning the resume.

WHAT TO CHANGE
- Reword existing bullet points to mirror the language and priorities of the job description.
- Reorder bullets within each role so the most JD-relevant ones come first.
- Reweight the skills section so the most JD-aligned skills appear first; you may remove clearly off-topic skills and surface skills evidenced in the career-context profile.
- Tighten phrasing: action verb + scope + measurable impact wherever the source supports it.

WHAT YOU MUST NOT DO
- Do NOT invent new employers, job titles, dates, schools, certifications, or specific metrics. If the original doesn't say "increased X by 40%", you don't get to either.
- Do NOT add new sections that weren't in the original.
- Do NOT change the document class, packages, geometry, fonts, or custom command definitions.
- Do NOT add LaTeX comments narrating your changes.

OUTPUT FORMAT — STRICT
- Output ONLY raw LaTeX, starting with the very first character of \\documentclass and ending with \\end{document}.
- NO markdown code fences (no triple backticks, no \`latex\` tag).
- NO commentary, preamble, or trailing notes.
- The output must compile with the same toolchain the original was authored for.
${ccBlock}${jdBlock}${texBlock}
Now produce the tailored LaTeX document. Begin immediately with \\documentclass.`;
}
