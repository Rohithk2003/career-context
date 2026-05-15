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

export async function scrapeJobUrl(url: string): Promise<ScrapedJob> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Firecrawl is not configured. Set FIRECRAWL_API_KEY in .env.local.",
    );
  }
  const client = new Firecrawl({ apiKey });
  const res = (await client.v1.scrapeUrl(url, {
    formats: ["markdown"],
    onlyMainContent: true,
  })) as {
    success?: boolean;
    error?: string;
    markdown?: string;
    metadata?: { title?: string; ogTitle?: string };
  };
  if (res.success === false) {
    throw new Error(res.error || "Firecrawl scrape failed");
  }
  const markdown = (res.markdown ?? "").trim();
  if (!markdown) {
    throw new Error("Scraped page returned no readable content.");
  }
  const title =
    res.metadata?.title?.trim() ||
    res.metadata?.ogTitle?.trim() ||
    null;
  return { url, title, content: markdown.slice(0, 20_000) };
}
