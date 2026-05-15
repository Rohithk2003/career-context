import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k)),
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Replace common Unicode punctuation with ASCII equivalents. Used to keep
 * generated résumés / cover letters paste-safe into ATS forms that mangle
 * Unicode. LLMs sprinkle em-dashes, smart quotes, and ellipses regardless
 * of how forcefully you ask them not to — so we strip them server-side.
 *
 * Replaces (left to right preserves order so chained replacements don't fight):
 *   em-dash, en-dash, hyphen-minus variants  ->  -
 *   smart double quotes                       ->  "
 *   smart single quotes / apostrophe          ->  '
 *   ellipsis                                  ->  ...
 *   bullet, middle dot, small bullets         ->  -  (only when used as list marker)
 *   non-breaking / zero-width / thin spaces   ->  regular space (or removed)
 *   arrows                                    ->  ASCII text
 *
 * Markdown control chars (#, -, *, `, |) and any plain ASCII pass through.
 */
export function sanitizeAsciiPunctuation(text: string): string {
  return text
    .replace(/[–—―−]/g, "-") // en/em/horizontal-bar/minus
    .replace(/[“”„‟″]/g, '"') // double smart quotes
    .replace(/[‘’‚‛′]/g, "'") // single smart quotes
    .replace(/…/g, "...") // ellipsis
    .replace(/[•‣◦⁃]/g, "-") // bullets
    .replace(/·/g, "-") // middle dot
    .replace(/ /g, " ") // non-breaking space
    .replace(/[​‌‍﻿]/g, "") // zero-width
    .replace(/[    ]/g, " ") // en/em/thin/narrow no-break space
    .replace(/→/g, "->") // rightwards arrow
    .replace(/←/g, "<-")
    .replace(/↔/g, "<->")
    .replace(/[✓✔]/g, "[x]") // checkmarks
    .replace(/[✗✘]/g, "[ ]"); // crosses
}
