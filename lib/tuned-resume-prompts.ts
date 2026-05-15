import type { GitHubProfileAggregate } from "./types";
import { truncate } from "./utils";

interface BuildTunedResumeMarkdownPromptArgs {
	resumeText: string;
	github: GitHubProfileAggregate | null;
	jobDescription: string;
	careerContext: string | null;
}

export function buildTunedResumeMarkdownPrompt(
	args: BuildTunedResumeMarkdownPromptArgs,
): string {
	const { resumeText, github, jobDescription, careerContext } = args;

	const ccBlock = careerContext
		? `\n---CAREER CONTEXT PROFILE (synthesized — use for prioritization)---\n${truncate(careerContext, 6_000)}\n---END CONTEXT---\n`
		: "";

	const githubBlock = github
		? `\n---GITHUB (compact, for evidence)---\n${JSON.stringify(
				{
					handle: github.username,
					top_languages: github.top_languages.slice(0, 8),
					pinned_repos: github.pinned_repos.slice(0, 6).map((r) => ({
						name: r.name,
						description: r.description,
						language: r.language,
						stars: r.stars,
					})),
				},
				null,
				2,
			)}\n---END GITHUB---\n`
		: "";

	return `You are rewriting a résumé to better align with a target job description. Output a clean, ATS-friendly Markdown resume — same content as the original, sharpened for this role.

STRUCTURE (output as Markdown, in this exact order — only include sections the original has evidence for)
- Top line: \`# {Candidate Name}\` (pull from the original resume; if absent, write \`# [Your Name]\`).
- A one-line contact strip on the next line: email · phone · location · LinkedIn · GitHub — only fields the original lists.
- \`## Summary\` — a 2–3 sentence positioning paragraph aligned to the JD. No clichés. Lead with seniority + strongest signal for this role.
- \`## Experience\` — each role as \`### {Title} — {Company}\` then a line \`{Location} · {start}–{end}\`, then 3–5 tightened bullet points. Reorder bullets within each role so the most JD-relevant ones come first. Tighten phrasing: action verb + scope + measurable impact when the source supports it. Never invent metrics.
- \`## Skills\` — grouped (e.g. **Languages**, **Backend**, **Frontend**, **Data/ML**, **Infra/DevOps**, **Tools**) with the most JD-aligned skills first within each group. Drop clearly off-topic skills from the original. Do NOT add skills the original doesn't evidence.
- \`## Education\` — preserve verbatim degree, institution, year if present.
- \`## Projects\` — only if the original has them; 1–3 strongest, prioritising those that map to the JD. Pull repo names from GitHub if the resume itself lists projects.
- \`## Certifications\` / \`## Publications\` / \`## Awards\` — include only if present in the original.

HARD CONSTRAINTS
- Do NOT invent employers, titles, dates, schools, certifications, projects, or specific metrics. If the original doesn't say "increased X by 40%", you don't either.
- Do NOT add sections that weren't in the original (except Summary, which you may add if missing).
- Do NOT add the word "tailored" or any meta commentary about what changed.
- Do NOT use first-person pronouns in bullets.
- Keep total output under ~700 words. Resumes are dense, not verbose.
- Output ONLY the Markdown resume. No preamble like "Here is...", no code fences, no trailing notes.
${ccBlock}
---TARGET JOB DESCRIPTION---
${truncate(jobDescription, 8_000)}
---END JD---
${githubBlock}
---ORIGINAL RESUME (raw text)---
${truncate(resumeText, 20_000)}
---END RESUME---

Now produce the tailored Markdown resume. Begin immediately with \`# \`.`;
}

interface BuildTunedResumeLatexPromptArgs {
	tunedResumeMarkdown: string;
	template: string;
}

export function buildTunedResumeLatexPrompt(
	args: BuildTunedResumeLatexPromptArgs,
): string {
	const { tunedResumeMarkdown, template } = args;

	return `You are converting a Markdown résumé into a complete, compilable LaTeX document.

GOAL
Fill the provided LaTeX template with the resume content. Preserve the template's preamble, packages, custom commands, and styling exactly — you are only inserting body content.

PROCEDURE
1. Use the template below as-is.
2. Locate the placeholder \`%%RESUME_BODY%%\` inside \\begin{document} ... \\end{document}.
3. Replace ONLY that placeholder with the resume content rendered as LaTeX.
4. Replace \`%%CANDIDATE_NAME%%\` with the candidate's full name from the Markdown title (\`# Name\`).
5. Replace \`%%CONTACT_LINE%%\` with the contact strip from the second line of the Markdown, rendered as LaTeX with each field separated by \`\\textbullet\`. Linkify URLs with \\href when possible.
6. Use the template's section macros (\\section* or \\rsection if defined) for each \`##\` heading. Use the role macros (\\rrole or just bold + italics fallback) for \`###\` lines.
7. Each bullet point becomes \`\\item\` inside an \`itemize\` environment.
8. Escape LaTeX special characters in body content: & % $ # _ { } and stray backslashes. Convert " ... " smart quotes to \`\`...''.

OUTPUT FORMAT — STRICT
- Output ONLY raw LaTeX, starting with the first character of \\documentclass and ending with \\end{document}.
- NO markdown code fences. NO commentary. NO preamble like "Here is...".

---LATEX TEMPLATE---
${template}
---END TEMPLATE---

---RESUME (Markdown)---
${tunedResumeMarkdown}
---END RESUME---

Now produce the complete LaTeX document. Begin immediately with \\documentclass.`;
}
