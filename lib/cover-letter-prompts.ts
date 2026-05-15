import type { GitHubProfileAggregate } from "./types";
import { truncate } from "./utils";

interface BuildCoverLetterMarkdownPromptArgs {
	resumeText: string | null;
	github: GitHubProfileAggregate | null;
	jobDescription: string;
	careerContext: string;
}

export function buildCoverLetterMarkdownPrompt(
	args: BuildCoverLetterMarkdownPromptArgs,
): string {
	const { resumeText, github, jobDescription, careerContext } = args;

	const resumeBlock = resumeText
		? `\n---RESUME (raw, for ground-truth specifics)---\n${truncate(resumeText, 12_000)}\n---END RESUME---\n`
		: "\n(No resume text provided — rely on the career context.)\n";

	const githubBlock = github
		? `\n---GITHUB (compact)---\n${JSON.stringify(
				{
					handle: github.username,
					name: github.name,
					bio: github.bio,
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

	return `You are writing a tailored cover letter for the candidate below, aimed at the target job description.

GOAL
A single-page cover letter that reads like a thoughtful human wrote it for *this specific role at this specific company*. It should be specific, evidence-grounded, and free of cliches.

STRUCTURE (output as clean Markdown, in this exact order, no top-level title)
1. **Greeting line** — "Dear Hiring Manager," (use the team or company name only if it appears in the JD).
2. **Opening paragraph (2–3 sentences)** — state the role being applied for, name the company if known from the JD, and a single sharp sentence on why the candidate is a strong fit. No "I am writing to apply for..." filler.
3. **Body paragraph 1 (3–5 sentences)** — concrete experience that maps to the JD's most important requirements. Cite at least one specific employer, project, or metric from the resume or GitHub. Mirror the JD's language where natural.
4. **Body paragraph 2 (3–5 sentences)** — a second axis of fit: technical depth, domain interest, leadership, or trajectory. Reference a real project or repo by name if available.
5. **Closing paragraph (2–3 sentences)** — what the candidate is excited about in this specific role, and a clean call to next steps. No "I would welcome the opportunity..." cliche.
6. **Sign-off** — "Sincerely," on its own line, then the candidate's full name on the next line. Pull the name from the resume; if not found, write "[Your Name]" so the user can fill it in.

HARD CONSTRAINTS
- Do NOT invent employers, titles, dates, schools, certifications, metrics, or projects. If the resume doesn't say "increased X by 40%", you don't either.
- Do NOT use these phrases or anything like them: "I am writing to apply", "results-driven", "team player", "passionate", "synergize", "leverage", "robust", "comprehensive", "seamless", "go-getter", "self-starter", "I would welcome the opportunity".
- Do NOT use bullet points or numbered lists. Cover letters are prose.
- Do NOT exceed ~350 words total.
- Do NOT include a postal address block or date. Modern cover letters skip those.
- Output ONLY the Markdown cover letter. No commentary, no preamble like "Here is...", no code fences.

---CAREER CONTEXT PROFILE (synthesized)---
${truncate(careerContext, 8_000)}
---END CONTEXT---

---TARGET JOB DESCRIPTION---
${truncate(jobDescription, 8_000)}
---END JD---
${resumeBlock}${githubBlock}
Now write the cover letter. Begin with the greeting line.`;
}

interface BuildCoverLetterLatexPromptArgs {
	coverLetterMarkdown: string;
	template: string;
}

export function buildCoverLetterLatexPrompt(
	args: BuildCoverLetterLatexPromptArgs,
): string {
	const { coverLetterMarkdown, template } = args;

	return `You are converting a Markdown cover letter into a complete, compilable LaTeX document.

GOAL
Fill the provided LaTeX template with the cover letter content. Preserve the template's preamble, packages, and styling exactly — you are only inserting body content.

PROCEDURE
1. Use the template below as-is.
2. Locate the placeholder \`%%COVER_LETTER_BODY%%\` inside \\begin{document} ... \\end{document}.
3. Replace ONLY that placeholder with the cover letter content, formatted as LaTeX paragraphs (blank lines between paragraphs; do NOT use \\par).
4. Replace the \`%%CANDIDATE_NAME%%\` placeholder with the candidate's full name as it appears in the sign-off of the Markdown. If the sign-off says "[Your Name]", keep "[Your Name]" verbatim.
5. Escape LaTeX special characters in the body: & % $ # _ { } and stray backslashes. Convert " ... " smart quotes to \`\`...''.
6. The greeting (e.g. "Dear Hiring Manager,") goes on its own line, followed by a blank line, then paragraphs.
7. The sign-off ("Sincerely,") on its own line followed by the name on its own line. Use \\\\ between them, or two lines separated by a blank line — your call, whichever the template style implies.

OUTPUT FORMAT — STRICT
- Output ONLY raw LaTeX, starting with the first character of \\documentclass and ending with \\end{document}.
- NO markdown code fences. NO commentary. NO preamble like "Here is...".

---LATEX TEMPLATE---
${template}
---END TEMPLATE---

---COVER LETTER (Markdown)---
${coverLetterMarkdown}
---END COVER LETTER---

Now produce the complete LaTeX document. Begin immediately with \\documentclass.`;
}
