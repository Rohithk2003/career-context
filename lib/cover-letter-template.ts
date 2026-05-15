// Default cover-letter LaTeX template. Clean, single-page, professional.
// Uses only widely-available packages so it compiles under both Tectonic
// and standard pdfLaTeX. Two placeholders the LLM fills:
//   %%CANDIDATE_NAME%%        — pulled from the resume sign-off
//   %%COVER_LETTER_BODY%%     — greeting + paragraphs + sign-off as LaTeX prose
export const DEFAULT_COVER_LETTER_TEMPLATE = String.raw`\documentclass[11pt]{letter}
\usepackage[a4paper,margin=1in]{geometry}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{microtype}
\usepackage{parskip}
\usepackage[hidelinks]{hyperref}

\signature{%%CANDIDATE_NAME%%}
\address{}

\begin{document}
\pagestyle{empty}

\noindent
%%COVER_LETTER_BODY%%

\end{document}`;
