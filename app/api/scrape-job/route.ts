import { NextRequest, NextResponse } from "next/server";
import { isFirecrawlConfigured, scrapeJobUrl } from "@/lib/firecrawl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ScrapeBody {
  url?: string;
}

export async function POST(req: NextRequest) {
  if (!isFirecrawlConfigured()) {
    return NextResponse.json(
      {
        error:
          "Firecrawl is not configured. Set FIRECRAWL_API_KEY in .env.local.",
      },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as ScrapeBody;
  const raw = body.url?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "Provide a job posting URL." },
      { status: 400 },
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a valid URL." },
      { status: 400 },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http(s) URLs are supported." },
      { status: 400 },
    );
  }

  try {
    const scraped = await scrapeJobUrl(parsed.toString());
    return NextResponse.json(scraped);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to scrape URL";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
