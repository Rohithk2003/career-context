import "server-only";
import { Firecrawl } from "@mendable/firecrawl-js";

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY?.trim();
}

export interface ScrapedJob {
  url: string;
  title: string | null;
  content: string;
}

interface FirecrawlScrapeResult {
  success?: boolean;
  error?: string;
  markdown?: string;
  metadata?: {
    title?: string;
    ogTitle?: string;
    statusCode?: number;
    error?: string;
    sourceURL?: string;
  };
}

// Pages that return a 4xx upstream OR whose title is one of the well-known
// bot-challenge strings count as blocked even when Firecrawl's wrapper claims
// success: true. Confirmed on Indeed (Security Check / 403) and LinkedIn
// (Sign In to view). Pattern-match liberally; false positives just trigger a
// stealth retry which is still cheap.
const BOT_CHALLENGE_TITLES = [
  /security check/i,
  /are you a robot/i,
  /just a moment/i,
  /access denied/i,
  /attention required/i,
  /verify you are human/i,
  /please enable cookies/i,
];

function looksBlocked(res: FirecrawlScrapeResult): boolean {
  const status = res.metadata?.statusCode ?? 0;
  if (status >= 400) return true;
  const title = res.metadata?.title?.trim();
  if (title && BOT_CHALLENGE_TITLES.some((re) => re.test(title))) return true;
  const md = (res.markdown ?? "").trim();
  // A few image placeholders and nothing else — pure challenge page.
  if (md.length < 80 && /Base64-Image-Removed/.test(md)) return true;
  return false;
}

async function callFirecrawl(
  client: Firecrawl,
  url: string,
  proxy: "auto" | "stealth",
): Promise<FirecrawlScrapeResult> {
  return (await client.v1.scrapeUrl(url, {
    formats: ["markdown"],
    onlyMainContent: true,
    proxy,
  } as Parameters<typeof client.v1.scrapeUrl>[1])) as FirecrawlScrapeResult;
}

export async function scrapeJobUrl(url: string): Promise<ScrapedJob> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Firecrawl is not configured. Set FIRECRAWL_API_KEY in .env.local.",
    );
  }
  const client = new Firecrawl({ apiKey });

  // Try cheap proxy first. Many career pages are scrape-friendly and don't
  // need to burn stealth credits. Sites like Indeed / LinkedIn fall through
  // to the stealth retry.
  let res = await callFirecrawl(client, url, "auto");
  if (looksBlocked(res)) {
    res = await callFirecrawl(client, url, "stealth");
  }

  if (res.success === false) {
    throw new Error(res.error || "Firecrawl scrape failed");
  }

  if (looksBlocked(res)) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "this site";
      }
    })();
    const status = res.metadata?.statusCode;
    throw new Error(
      `${host} is blocking automated scrapers${status ? ` (HTTP ${status})` : ""}. ` +
        "Paste the job description text directly into the box instead.",
    );
  }

  const markdown = (res.markdown ?? "").trim();
  if (!markdown) {
    throw new Error("Scraped page returned no readable content.");
  }
  const title =
    res.metadata?.title?.trim() || res.metadata?.ogTitle?.trim() || null;
  return { url, title, content: markdown.slice(0, 20_000) };
}
