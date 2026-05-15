import { NextRequest, NextResponse } from "next/server";
import {
  compileLatexToPdf,
  isLikelyLatex,
  LatexToolchainMissingError,
} from "@/lib/latex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CompileLatexBody {
  latex?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CompileLatexBody;
  const latex = typeof body.latex === "string" ? body.latex : "";

  if (!latex.trim()) {
    return NextResponse.json(
      { error: "Missing `latex` field in request body." },
      { status: 400 },
    );
  }
  if (!isLikelyLatex(latex)) {
    return NextResponse.json(
      {
        error:
          "Body does not look like a LaTeX document (no \\documentclass / \\begin{document}).",
      },
      { status: 400 },
    );
  }

  try {
    const pdf = await compileLatexToPdf(latex);
    // NextResponse can take a BodyInit; an ArrayBuffer is the cleanest cross-runtime payload.
    // We slice the underlying buffer to a fresh ArrayBuffer to avoid sending more than the
    // actual PDF bytes when `pdf` is backed by a pooled Node Buffer.
    const ab = pdf.buffer.slice(
      pdf.byteOffset,
      pdf.byteOffset + pdf.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="resume.pdf"',
        "Content-Length": pdf.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof LatexToolchainMissingError) {
      return NextResponse.json(
        {
          error: err.message,
          hint: "Install Tectonic for a one-binary toolchain: `brew install tectonic` (macOS) — or install a TeX Live distribution that provides `pdflatex`.",
        },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "LaTeX compilation failed.";
    return NextResponse.json(
      { error: msg.slice(0, 4000) },
      { status: 500 },
    );
  }
}
