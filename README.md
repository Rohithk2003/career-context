# Career Context — Local AI Career Profile Generator

A privacy-first Next.js app that builds a structured **career context profile** from your resume, GitHub, and a target job description — using a locally-running **Ollama** model. Nothing about you is sent to a third-party LLM.

## Features

- **Drag-and-drop resume upload** — PDF, DOCX, **LaTeX (.tex)**, TXT, Markdown (parsed locally via `unpdf`, `mammoth`, and a built-in TeX-to-text extractor).
- **GitHub aggregation** — repos, languages, topics, pinned projects, profile README, activity heuristics. **Sign in with GitHub** for one-click access to your own profile (and higher rate limits).
- **Target JD analysis** — match score, requirement-by-requirement evidence table, resume positioning rewrites.
- **Live model discovery** — `/api/tags` is polled on load so the selector lists exactly what you have installed.
- **Streaming output** — synthesis tokens render token-by-token via SSE.
- **Layered prompt pipeline** — resume digest → GitHub digest → final synthesis, with `(inferred)` / `(confidence)` tags throughout.
- **Copy / export** the generated Markdown.
- **Dark, modern UI** built on Tailwind + Radix primitives.

## Requirements

- Node.js ≥ 20
- [Ollama](https://ollama.com/) running locally with at least one chat model pulled:
  ```bash
  ollama serve            # in one terminal
  ollama pull llama3.2    # any chat model works
  ```

## Getting started

```bash
npm install
cp .env.example .env.local   # optional; defaults to http://127.0.0.1:11434
npm run dev
```

Open <http://localhost:3000>.

## Optional environment

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434  # override if remote

# GitHub OAuth (recommended) — enables one-click sign-in:
GITHUB_CLIENT_ID=Iv1.xxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxx
# GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/github/callback  # only if needed

# Fallback PAT (used only when OAuth isn't set up and no one's signed in):
GITHUB_TOKEN=ghp_xxx
```

### Setting up GitHub OAuth

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Fill in:
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/github/callback`
3. Copy the **Client ID** and generate a **Client Secret**, then drop them into `.env.local`.
4. Restart `npm run dev`. The GitHub card on the left will now show a **Sign in with GitHub** button.

Requested scope: `read:user` only — we never ask for write or repo-content access.

## Architecture

```
app/
  api/
    models/route.ts        # GET — lists installed Ollama models
    parse-resume/route.ts  # POST — multipart upload → extracted text
    github/route.ts        # POST — { handle } → aggregated profile
    generate/route.ts      # POST — orchestrates 3-step pipeline, streams SSE
  layout.tsx
  page.tsx                 # single-page client UI
components/
  ui/*                     # shadcn/ui-style primitives
  resume-dropzone.tsx
  github-input.tsx
  model-selector.tsx
  output-panel.tsx
  markdown.tsx             # zero-dep Markdown renderer for streaming text
lib/
  ollama.ts                # /api/tags + streaming /api/generate client
  resume.ts                # pdf / docx / text extraction
  github.ts                # REST aggregation + pinned-repos scrape
  prompts.ts               # layered prompt builders + system prompt
  types.ts
  utils.ts
```

## Prompt pipeline

1. **Resume understanding** — extracts roles, education, skills, achievements, signal domains as a compact Markdown digest.
2. **GitHub enrichment** — distills active stack, themes, signals, project highlights, activity profile.
3. **Synthesis** — final recruiter-aware profile with the eleven required sections (Professional Summary, Technical Skills, Experience Highlights, Open Source & GitHub Insights, Career Interests, Strengths, Weaknesses / Gaps, Suggested Roles, Match Analysis Against JD, Resume Positioning Suggestions, Recommended Learning Roadmap, Recruiter-style Candidate Overview).

Inference uses **only the user's data** as evidence. Every non-factual claim must be tagged `(inferred: …)` or with a `(confidence: low|medium|high)` annotation per the system prompt.

## Notes

- Pinned-repo discovery scrapes the public profile HTML (GitHub doesn't expose it via REST). It falls back to most-starred repos if scraping yields nothing.
- The PDF extractor disables fonts / eval / workers so it works in the Node runtime without canvas.
- Generation streams via SSE rather than React Server Actions because we need stage events alongside token deltas.
