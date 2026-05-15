"use client";
import * as React from "react";

/**
 * Tiny zero-dep Markdown renderer tuned for our streaming career-context output.
 * Supports: headings (h1–h3), bullets, ordered lists, tables (pipe), bold/italic/code,
 * blockquotes, and hr. Deliberately minimal to avoid pulling react-markdown.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2 hover:text-primary/80">$1</a>',
  );
  return out;
}

function renderTable(rows: string[]): string {
  const cells = rows.map((r) =>
    r
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim()),
  );
  if (cells.length < 2) return "";
  // Detect header separator row
  const isSep = cells[1].every((c) => /^:?-{2,}:?$/.test(c));
  const header = isSep ? cells[0] : null;
  const dataStart = isSep ? 2 : 0;
  const body = cells.slice(dataStart);

  return (
    '<div class="my-3 overflow-x-auto rounded-lg border border-border/60 scrollbar-thin">' +
    '<table class="w-full text-xs">' +
    (header
      ? "<thead><tr>" +
        header
          .map(
            (h) =>
              `<th class="bg-muted/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">${inline(h)}</th>`,
          )
          .join("") +
        "</tr></thead>"
      : "") +
    "<tbody>" +
    body
      .map(
        (row) =>
          '<tr class="border-b border-border/40 last:border-0">' +
          row
            .map(
              (c) =>
                `<td class="px-3 py-2 align-top text-foreground/90">${inline(c)}</td>`,
            )
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Table block
    if (/^\s*\|/.test(line)) {
      const tableRows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tableRows.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableRows));
      continue;
    }

    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 6);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // HR
    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push("<ul>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>");
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push("<ol>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ol>");
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-special lines)
    const paraBuf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      paraBuf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(paraBuf.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function Markdown({ source }: { source: string }) {
  const html = React.useMemo(() => markdownToHtml(source), [source]);
  return (
    <div
      className="prose-context"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
