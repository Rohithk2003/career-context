// Default tuned-résumé LaTeX template. Single-column, ATS-friendly, uses only
// widely-available packages so it compiles under both Tectonic and standard
// pdfLaTeX. Three placeholders the LLM fills:
//   %%CANDIDATE_NAME%%        — from the `# Name` line in the Markdown
//   %%CONTACT_LINE%%          — one-line contact strip (email · phone · …)
//   %%RESUME_BODY%%           — the rest of the resume as LaTeX
export const DEFAULT_TUNED_RESUME_TEMPLATE = String.raw`\documentclass[10.5pt,letterpaper]{article}
\usepackage[margin=0.65in]{geometry}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{microtype}
\usepackage{parskip}
\usepackage{enumitem}
\setlist[itemize]{leftmargin=*,topsep=2pt,itemsep=1pt,parsep=0pt}
\usepackage{titlesec}
\titleformat{\section}{\large\bfseries\uppercase}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{8pt}{4pt}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}

\begin{document}

\begin{center}
{\LARGE\bfseries %%CANDIDATE_NAME%%}\\[3pt]
{\small %%CONTACT_LINE%%}
\end{center}

%%RESUME_BODY%%

\end{document}`;
