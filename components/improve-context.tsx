"use client";
import * as React from "react";
import {
  MessageSquare,
  Send,
  Loader2,
  AlertCircle,
  Square,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LlmProvider } from "@/lib/types";

interface Props {
  provider: LlmProvider | null;
  model: string;
  currentContext: string;
  onRevised: (newContext: string) => void;
  /** When true, render without the outer card chrome so the component embeds
   *  cleanly inside another card (e.g. as the OutputPanel footer). */
  compact?: boolean;
}

type SseEvent =
  | { type: "stage"; stage: string; status: "start" | "done" }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  // Wall-clock when this turn finished. Used to render "Revised Xm ago" for
  // assistant turns. Stored as ms epoch.
  at: number;
}

function formatAgo(now: number, then: number): string {
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function ImproveContext({
  provider,
  model,
  currentContext,
  onRevised,
  compact = false,
}: Props) {
  const [instruction, setInstruction] = React.useState("");
  const [history, setHistory] = React.useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Re-render every 30s so "Xm ago" stays fresh.
  const [, forceTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const abortRef = React.useRef<AbortController | null>(null);

  const ready = !!provider && !!model && !!currentContext;
  const canSend = ready && !!instruction.trim() && !streaming;

  const handleSend = async () => {
    if (!canSend || !provider) return;
    const userInstruction = instruction.trim();
    setError(null);
    setInstruction("");
    setStreaming(true);

    // Build the prior-history payload BEFORE we append the new user turn, so
    // the server sees "history excluding the current turn" per the contract.
    const priorHistory = history.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    // Optimistically show the user turn in the UI.
    setHistory((prev) => [
      ...prev,
      { role: "user", content: userInstruction, at: Date.now() },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let revised = "";
    try {
      const res = await fetch("/api/improve-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          currentContext,
          instruction: userInstruction,
          history: priorHistory,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res
          .json()
          .catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let sawError = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          const payload = raw.slice(5).trim();
          if (!payload) continue;
          let event: SseEvent;
          try {
            event = JSON.parse(payload) as SseEvent;
          } catch {
            continue;
          }
          if (event.type === "delta") {
            revised += event.text;
          } else if (event.type === "error") {
            sawError = true;
            setError(event.message);
          }
        }
      }

      if (!sawError) {
        const trimmed = revised.trim();
        if (!trimmed) {
          throw new Error("Model returned an empty revision.");
        }
        onRevised(trimmed);
        setHistory((prev) => [
          ...prev,
          { role: "assistant", content: trimmed, at: Date.now() },
        ]);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(
          e instanceof Error ? e.message : "Context revision failed",
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  const now = Date.now();

  // Render history as alternating user instruction + a short "Revised Xm ago"
  // marker for the matching assistant turn. We intentionally don't echo the
  // assistant's full output here — the revised profile is shown in the panel
  // above.
  const rendered: Array<
    | { kind: "user"; content: string; at: number; key: string }
    | { kind: "revised"; at: number; key: string }
  > = [];
  history.forEach((t, i) => {
    if (t.role === "user") {
      rendered.push({
        kind: "user",
        content: t.content,
        at: t.at,
        key: `u-${i}`,
      });
    } else {
      rendered.push({ kind: "revised", at: t.at, key: `a-${i}` });
    }
  });

  return (
    <section
      className={
        compact
          ? "animate-fade-in"
          : "rounded-xl border border-border/80 bg-card/40 p-5 backdrop-blur-sm animate-fade-in"
      }
      aria-label="Chat to improve career context"
    >
      <header
        className={
          compact
            ? "mb-2 flex flex-wrap items-center gap-2"
            : "mb-4 flex flex-wrap items-center justify-between gap-3"
        }
      >
        <div className="flex items-center gap-2">
          {!compact && (
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
            </div>
          )}
          <div className="leading-tight">
            <p
              className={
                compact
                  ? "text-xs font-medium tracking-tight inline-flex items-center gap-1.5"
                  : "text-sm font-semibold tracking-tight"
              }
            >
              {compact && <MessageSquare className="h-3 w-3 text-primary" />}
              Chat to improve
            </p>
            {!compact && (
              <p className="text-[11px] text-muted-foreground">
                Nudge the model — e.g. &quot;make the summary more
                technical&quot; or &quot;drop the consulting angle&quot;.
              </p>
            )}
          </div>
        </div>
      </header>

      {!ready && (
        <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
          Generate a career context profile first, then chat here to refine it.
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}

      {rendered.length > 0 && (
        <ol className="mb-4 space-y-2">
          {rendered.map((item) => {
            if (item.kind === "user") {
              return (
                <li
                  key={item.key}
                  className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    You
                  </div>
                  <div className="whitespace-pre-wrap break-words text-foreground/90">
                    {item.content}
                  </div>
                </li>
              );
            }
            return (
              <li
                key={item.key}
                className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-300/90"
              >
                <Sparkles className="h-3 w-3" />
                Revised ({formatAgo(now, item.at)})
              </li>
            );
          })}
        </ol>
      )}

      <div className="space-y-2">
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            ready
              ? "What should change? (Cmd/Ctrl+Enter to send)"
              : "Generate a profile first to enable chat-to-improve."
          }
          disabled={!ready || streaming}
          rows={3}
          className="text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {streaming
              ? "Revising profile…"
              : history.length > 0
                ? `${history.filter((t) => t.role === "user").length} turn${history.filter((t) => t.role === "user").length === 1 ? "" : "s"} so far`
                : "Your edits replace the profile above on each turn."}
          </p>
          <div className="flex items-center gap-2">
            {streaming ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStop}
                className="h-8"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!canSend}
                className="h-8"
              >
                {streaming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
