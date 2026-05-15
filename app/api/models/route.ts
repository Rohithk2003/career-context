import { NextResponse } from "next/server";
import { OLLAMA_BASE_URL } from "@/lib/ollama";
import { listAvailableModels } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { models, errors } = await listAvailableModels();
  return NextResponse.json({ models, errors, baseUrl: OLLAMA_BASE_URL });
}
