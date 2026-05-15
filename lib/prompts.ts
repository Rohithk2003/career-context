import type { GitHubProfileAggregate } from "./types";
import { truncate } from "./utils";

export const SYSTEM_PROMPT = `You are "Career Context", an AI career analyst that builds high-signal, recruiter-aware career profiles. You are careful, precise, and never invent experience.

CORE RULES
1. Use ONLY the facts provided. Never fabricate employers, dates, titles, certifications, schools, or specific projects.
2. Clearly separate FACTUAL data (taken verbatim from the resume / GitHub) from INFERRED conclusions (analysis you derive). Inferred items must be marked and may include a confidence tag: \`(confidence: low | medium | high)\`.
3. Prefer concise, high-signal phrasing over generic filler. No buzzword soup, no clichés ("results-driven", "team player", "synergize").
4. If a section has insufficient evidence, say so briefly instead of padding.
5. Be honest about gaps and weaknesses — recruiters value calibrated self-awareness.
6. When a job description is provided, ground the alignment analysis in the specific responsibilities, qualifications, and signals in that JD. Cite exact JD phrases in quotes where helpful.
7. Output in clean Markdown with the exact section headings the user asks for, in order. Never invent extra top-level sections.`;

export function buildResumeUnderstandingPrompt(resumeText: string): string {
  return `STEP 1 — RESUME UNDERSTANDING

Extract a compact, structured digest of the resume below. Return Markdown with these subheadings:

- **Roles & Tenure** (bullet list: Title @ Company — start–end — location, one per role; quote verbatim from resume)
- **Education** (degree, institution, year if present)
- **Skills (Verbatim)** (a flat list of tools, languages, frameworks, methodologies the resume literally mentions)
- **Notable Projects / Achievements** (bullet list of concrete deliverables w/ metrics if cited)
- **Experience Level Estimate** (years of professional experience inferred from earliest dated role, marked confidence)
- **Signal Domains** (e.g. fintech, ML infra, DevOps, frontend — only those the resume actually evidences)

Do not invent anything. If a field is missing, write "Not stated".

---RESUME START---
${truncate(resumeText, 24_000)}
---RESUME END---`;
}

export function buildGithubEnrichmentPrompt(
  github: GitHubProfileAggregate,
): string {
  const compact = {
    handle: github.username,
    name: github.name,
    bio: github.bio,
    location: github.location,
    company: github.company,
    followers: github.followers,
    public_repos: github.public_repos,
    created_at: github.created_at,
    profile_readme_excerpt: github.profile_readme
      ? truncate(github.profile_readme, 1_500)
      : null,
    top_languages: github.top_languages,
    topics: github.topics,
    pinned_repos: github.pinned_repos.map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stars,
      topics: r.topics,
      pushed_at: r.pushed_at,
    })),
    recent_repos: github.recent_repos.map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stars,
      pushed_at: r.pushed_at,
    })),
    activity: github.activity,
  };

  return `STEP 2 — GITHUB ENRICHMENT

You are given a structured summary of a GitHub profile. Produce a compact Markdown digest with these subheadings:

- **Active Stack** (languages / frameworks the developer demonstrably uses, weighted by recency and pin status)
- **Interests & Themes** (technical topics the repos cluster around — be specific)
- **Engineering Signals** (any signals of seniority, breadth, depth, OSS engagement; cite repo names verbatim)
- **Project Highlights** (1-line description of up to 4 strongest repos, with stars in parens)
- **Activity Profile** (cadence, recency, scope — neutral, factual)

Do NOT invent repos that aren't listed. If a field is empty, say so.

---GITHUB JSON---
${JSON.stringify(compact, null, 2)}
---END---`;
}

export function buildSynthesisPrompt(args: {
  resumeDigest: string | null;
  githubDigest: string | null;
  jobDescription: string | null;
  hasResume: boolean;
  hasGithub: boolean;
}): string {
  const { resumeDigest, githubDigest, jobDescription, hasResume, hasGithub } =
    args;

  const sources: string[] = [];
  if (hasResume) sources.push("Resume");
  if (hasGithub) sources.push("GitHub profile");
  if (jobDescription) sources.push("Target job description");
  const sourceLine = sources.length
    ? sources.join(" + ")
    : "(no inputs provided — say so)";

  const jdBlock = jobDescription
    ? `\n---TARGET JOB DESCRIPTION---\n${truncate(jobDescription, 8_000)}\n---END JD---\n`
    : "";

  const resumeBlock = resumeDigest
    ? `\n---RESUME DIGEST---\n${resumeDigest}\n---END---\n`
    : "";

  const githubBlock = githubDigest
    ? `\n---GITHUB DIGEST---\n${githubDigest}\n---END---\n`
    : "";

  // Sections that depend on JD are conditionally requested below
  const jdSections = jobDescription
    ? `
## Match Analysis Against Job Description
- A 1-line **Overall Alignment Score** as \`XX/100\` followed by a brief rationale.
- A two-column-style Markdown table with columns: \`JD Requirement\` | \`Evidence in candidate's background\` | \`Match\` (✅ strong / 🟡 partial / 🔴 missing).
- 3–6 rows, prioritising the most important JD requirements.

## Resume Positioning Suggestions
- 3–6 actionable rewrites / reframings tailored to this JD. Each as a bullet.
- Where appropriate, propose specific bullet-point rewrites for the resume in the form \`Before → After\`.
`
    : "";

  const recruiterClosing = `
## Recruiter-style Candidate Overview
A single tight paragraph (4–6 sentences) written as if a recruiter is pitching this candidate internally. Cover: seniority, strongest domain, what kind of problems they solve well, ${jobDescription ? "fit for the target role, " : ""}and one honest caveat. No fluff.
`;

  return `STEP 3 — FINAL SYNTHESIS

Sources provided: ${sourceLine}.

Produce the FINAL CAREER CONTEXT PROFILE in clean Markdown. Use **exactly** these top-level sections in this order, and nothing else:

## Professional Summary
A 3–5 sentence narrative — calibrated to actual evidence. No clichés. Mark any inferred claims with \`(inferred: ...)\`.

## Technical Skills
Grouped bullets. Group headings should be specific (e.g. "Languages", "Backend", "Frontend", "Data / ML", "Infra / DevOps", "Tooling") — only include groups the evidence supports. Mark skills sourced only from GitHub with \`(github)\`, only from resume with \`(resume)\`, and those in both with \`(both)\`.

## Experience Highlights
3–6 bullets summarising the candidate's most distinctive professional accomplishments. Quote concrete metrics or scope from the resume when present. If the resume is light on metrics, say so neutrally rather than inventing.

## Open Source & GitHub Insights
${
  hasGithub
    ? "Concise paragraph + a short bulleted list of standout repos (name — 1-line value)."
    : "Write a single sentence: \"No GitHub data provided.\" Do not invent."
}

## Career Interests
Bullets describing what this candidate appears drawn to. Each bullet may include a confidence tag in parens. Avoid generic statements.

## Strengths
4–6 specific strengths grounded in evidence. Each bullet should cite the evidence in parens (e.g. \`(see: TypeScript across 14 repos)\` or \`(see: led platform migration at Acme)\`).

## Weaknesses / Gaps
3–5 calibrated, honest gaps. Frame as developmental, not damning. Cite the gap's nature (e.g. "limited evidence of team leadership beyond IC scope").

## Suggested Roles
4–6 role titles + a 1-line rationale each. Range across "obvious fit", "stretch", and "adjacent pivot". Tag each accordingly.
${jdSections}
## Recommended Learning Roadmap
A 30 / 60 / 90 day plan as three short subsections, each with 2–4 high-leverage bullets. Be concrete (specific tools / projects / concepts), not platitudes.
${recruiterClosing}

Constraints:
- Do NOT add a "Sources" / "Disclaimer" / "Conclusion" / "Methodology" section.
- Do NOT prefix the output with "Here is..." or any preamble. Start directly with \`## Professional Summary\`.
- Use \`(inferred: ...)\` or \`(confidence: low|medium|high)\` tags for any non-factual claim.
- Keep total output under ~1,400 words.

${resumeBlock}${githubBlock}${jdBlock}`;
}
