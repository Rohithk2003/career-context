export type ResumeFileKind = "pdf" | "docx" | "text" | "latex";

export type LlmProvider =
  | "ollama"
  | "anthropic"
  | "openai"
  | "google"
  | "claude-code"
  | "codex";

export interface ParsedResume {
  kind: ResumeFileKind;
  fileName: string;
  bytes: number;
  text: string;
  charCount: number;
  truncated: boolean;
  /**
   * Raw LaTeX source when the uploaded file was a `.tex` resume. Used by the
   * downstream LaTeX-regen pipeline so we can produce a tailored .tex / .pdf
   * after the main career-context generation finishes. `null` (or absent) for
   * non-LaTeX uploads.
   */
  latexSource?: string | null;
}

export interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface GitHubRepoSummary {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  pushed_at: string | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  is_pinned?: boolean;
  url: string;
}

export interface GitHubProfileAggregate {
  username: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string | null;
  profile_readme: string | null;
  top_languages: Array<{ language: string; bytes: number; repos: number }>;
  topics: string[];
  recent_repos: GitHubRepoSummary[];
  pinned_repos: GitHubRepoSummary[];
  activity: {
    total_commits_estimate: number;
    repos_pushed_last_year: number;
    avg_stars: number;
    most_starred: GitHubRepoSummary | null;
  };
}

export interface GenerateRequestInputs {
  model: string;
  resume: { text: string; fileName?: string } | null;
  github: GitHubProfileAggregate | null;
  jobDescription: string | null;
}
