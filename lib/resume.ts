import "server-only";
import { latexToPlainText } from "./latex";
import type { ParsedResume, ResumeFileKind } from "./types";

const MAX_CHARS = 60_000;

function detectKind(name: string, mime: string): ResumeFileKind | null {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  )
    return "docx";
  if (
    lower.endsWith(".tex") ||
    lower.endsWith(".latex") ||
    mime === "application/x-tex" ||
    mime === "text/x-tex" ||
    mime === "application/x-latex"
  )
    return "latex";
  if (
    mime.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  )
    return "text";
  return null;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[​-‍﻿]/g, "")
    .trim();
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  // `unpdf` ships a serverless-friendly pdfjs build that doesn't try to spin
  // up a worker — no GlobalWorkerOptions.workerSrc to configure.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(buffer),
  });
  return value;
}

function extractLatexText(buffer: ArrayBuffer): string {
  const source = new TextDecoder("utf-8").decode(buffer);
  return latexToPlainText(source);
}

export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const kind = detectKind(file.name, file.type || "");
  if (!kind) {
    throw new Error(
      "Unsupported file type. Upload a PDF, DOCX, LaTeX (.tex), TXT, or Markdown resume.",
    );
  }
  const buffer = await file.arrayBuffer();
  let raw = "";
  if (kind === "pdf") raw = await extractPdfText(buffer);
  else if (kind === "docx") raw = await extractDocxText(buffer);
  else if (kind === "latex") raw = extractLatexText(buffer);
  else raw = new TextDecoder("utf-8").decode(buffer);

  const text = normalizeWhitespace(raw);
  if (!text || text.length < 40) {
    throw new Error(
      "Couldn't extract meaningful text from this file. If it's a scanned PDF, try exporting it as text first.",
    );
  }
  const truncated = text.length > MAX_CHARS;
  return {
    kind,
    fileName: file.name,
    bytes: buffer.byteLength,
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    charCount: text.length,
    truncated,
  };
}
