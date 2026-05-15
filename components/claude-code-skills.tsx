"use client";
import * as React from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
	/** Selected skill names. */
	value: string[];
	onChange: (skills: string[]) => void;
}

interface SkillsResponse {
	available: boolean;
	skills: string[];
	error?: string;
}

export function ClaudeCodeSkills({ value, onChange }: Props) {
	const [skills, setSkills] = React.useState<string[] | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);

	const load = React.useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch("/api/claude-code-skills", { cache: "no-store" });
			const data: SkillsResponse = await res.json();
			if (!res.ok) {
				throw new Error(data.error || `Failed (${res.status})`);
			}
			setSkills(data.skills);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load skills");
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		load();
	}, [load]);

	const toggle = (name: string) => {
		if (value.includes(name)) {
			onChange(value.filter((s) => s !== name));
		} else {
			onChange([...value, name]);
		}
	};

	const clear = () => onChange([]);

	if (loading && !skills) {
		return (
			<div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
				<Loader2 className="h-3 w-3 animate-spin" />
				Loading Claude Code skills…
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
				<Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
				<div className="min-w-0 flex-1 leading-relaxed">
					<p className="font-medium">Couldn&apos;t load skills</p>
					<p className="mt-0.5 text-amber-200/70">{error}</p>
				</div>
				<button
					type="button"
					onClick={load}
					className="shrink-0 text-amber-200/70 hover:text-amber-100"
					aria-label="Retry"
				>
					<RefreshCw className="h-3 w-3" />
				</button>
			</div>
		);
	}

	if (!skills || skills.length === 0) {
		return (
			<p className="text-[11px] text-muted-foreground">
				No Claude Code skills detected on this machine.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
					Claude Code skills{" "}
					<span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
						({skills.length} available · {value.length} selected)
					</span>
				</p>
				<div className="flex items-center gap-2">
					{value.length > 0 && (
						<button
							type="button"
							onClick={clear}
							className="text-[10px] text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					)}
					<button
						type="button"
						onClick={load}
						disabled={loading}
						className="text-muted-foreground hover:text-foreground"
						aria-label="Refresh skills"
					>
						{loading ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<RefreshCw className="h-3 w-3" />
						)}
					</button>
				</div>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{skills.map((name) => {
					const selected = value.includes(name);
					return (
						<button
							key={name}
							type="button"
							onClick={() => toggle(name)}
							className={cn(
								"inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10.5px] transition-colors",
								selected
									? "border-primary/40 bg-primary/15 text-primary"
									: "border-border/60 bg-muted/10 text-muted-foreground hover:border-border hover:bg-muted/20 hover:text-foreground",
							)}
							aria-pressed={selected}
						>
							{selected && <Sparkles className="h-2.5 w-2.5" />}/{name}
						</button>
					);
				})}
			</div>
			<p className="text-[11px] text-muted-foreground/85">
				Selected skills are invoked as <code className="font-mono">/name</code>{" "}
				lines at the top of the prompt sent to Claude Code.
			</p>
		</div>
	);
}
