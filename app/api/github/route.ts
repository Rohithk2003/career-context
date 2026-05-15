import { NextRequest, NextResponse } from "next/server";
import { aggregateGitHub } from "@/lib/github";
import { getServerToken } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { handle } = (await req.json().catch(() => ({}))) as {
      handle?: string;
    };
    const hasSession = !!getServerToken();
    if (!handle?.trim() && !hasSession) {
      return NextResponse.json(
        { error: "Provide a GitHub username or sign in with GitHub." },
        { status: 400 },
      );
    }
    const aggregate = await aggregateGitHub(handle ?? "");
    return NextResponse.json(aggregate);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch GitHub profile",
      },
      { status: 400 },
    );
  }
}
