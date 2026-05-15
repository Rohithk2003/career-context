import { NextResponse } from "next/server";
import {
	isClaudeCodeAvailable,
	listClaudeCodeSkills,
} from "@/lib/claude-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
	if (!(await isClaudeCodeAvailable())) {
		return NextResponse.json({ available: false, skills: [] });
	}
	try {
		const skills = await listClaudeCodeSkills();
		return NextResponse.json({ available: true, skills });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to list Claude Code skills";
		return NextResponse.json(
			{ available: true, skills: [], error: message },
			{ status: 500 },
		);
	}
}
