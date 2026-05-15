import * as React from "react";
import Link from "next/link";
import { Briefcase, Lock, ShieldCheck, User } from "lucide-react";
import { HeaderAuth } from "@/components/header-auth";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/40 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 shadow-[0_4px_20px_-4px_hsl(263_80%_68%/0.6)]">
            <Briefcase className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">
              Career Context
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Local · Private · Recruiter-aware
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> Runs on your machine
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> No telemetry
            </span>
          </div>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-card/80 hover:text-foreground"
          >
            <User className="h-3.5 w-3.5" />
            Profile
          </Link>
          <HeaderAuth />
        </div>
      </div>
    </header>
  );
}
