"use client";
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Cpu, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import type { LlmProvider } from "@/lib/types";

export interface ModelSelectorValue {
  provider: LlmProvider;
  model: string;
}

interface LlmModelEntry {
  provider: LlmProvider;
  id: string;
  label: string;
}

interface Props {
  value: ModelSelectorValue | null;
  onChange: (v: ModelSelectorValue) => void;
}

interface ModelsResponse {
  models?: LlmModelEntry[];
  error?: string;
  errors?: Partial<Record<LlmProvider, string>>;
  baseUrl?: string;
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  ollama: "Ollama (local)",
  "claude-code": "Claude Code (your subscription)",
  codex: "Codex CLI (ChatGPT subscription)",
  anthropic: "Anthropic API",
  openai: "OpenAI",
  google: "Google",
};

const PROVIDER_ORDER: LlmProvider[] = [
  "ollama",
  "claude-code",
  "codex",
  "anthropic",
  "openai",
  "google",
];

interface ProviderRequirement {
  label: string;
  requirement: React.ReactNode;
}

const PROVIDER_REQUIREMENTS: Record<LlmProvider, ProviderRequirement> = {
  ollama: {
    label: "Ollama (local)",
    requirement: (
      <>
        Run <code className="font-mono">ollama serve</code> and pull a model
        (e.g. <code className="font-mono">ollama pull llama3.2</code>). Fully
        offline.
      </>
    ),
  },
  "claude-code": {
    label: "Claude Code (your subscription)",
    requirement: (
      <>
        Install the CLI (
        <code className="font-mono">npm i -g @anthropic-ai/claude-code</code>
        ), then run <code className="font-mono">claude /login</code> once. Uses
        your Pro/Max subscription — no API key, no API billing.
      </>
    ),
  },
  codex: {
    label: "Codex CLI (ChatGPT subscription)",
    requirement: (
      <>
        Install the CLI (
        <code className="font-mono">npm i -g @openai/codex</code>) and run{" "}
        <code className="font-mono">codex login</code> once. Uses your ChatGPT
        Plus/Pro subscription — no API key.
      </>
    ),
  },
  anthropic: {
    label: "Anthropic API",
    requirement: (
      <>
        Set <code className="font-mono">ANTHROPIC_API_KEY</code> in{" "}
        <code className="font-mono">.env.local</code>. Pay-as-you-go via the
        Anthropic API.
      </>
    ),
  },
  openai: {
    label: "OpenAI",
    requirement: (
      <>
        Set <code className="font-mono">OPENAI_API_KEY</code> in{" "}
        <code className="font-mono">.env.local</code>.
      </>
    ),
  },
  google: {
    label: "Google",
    requirement: (
      <>
        Set <code className="font-mono">GOOGLE_GENERATIVE_AI_API_KEY</code> in{" "}
        <code className="font-mono">.env.local</code>.
      </>
    ),
  },
};

/**
 * Encodes a {provider, model} pair into a single string for the underlying
 * Radix <Select>, since SelectItem values are strings. We use a delimiter
 * unlikely to appear in a model id (`::`) — Ollama model ids use `:` for tags
 * (e.g. `llama3.2:latest`), so a doubled colon is safe.
 */
function encode(v: ModelSelectorValue): string {
  return `${v.provider}::${v.model}`;
}
function decode(s: string): ModelSelectorValue | null {
  const idx = s.indexOf("::");
  if (idx === -1) return null;
  const provider = s.slice(0, idx) as LlmProvider;
  const model = s.slice(idx + 2);
  if (!provider || !model) return null;
  return { provider, model };
}

export function ModelSelector({ value, onChange }: Props) {
  const [models, setModels] = React.useState<LlmModelEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ollamaError, setOllamaError] = React.useState<string | null>(null);
  const [baseUrl, setBaseUrl] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setOllamaError(null);
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      const data: ModelsResponse = await res.json();
      setBaseUrl(data.baseUrl ?? null);
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        setModels([]);
        return;
      }
      const list = data.models ?? [];
      setModels(list);
      if (data.errors?.ollama) setOllamaError(data.errors.ollama);

      // Auto-select the first available model if nothing is selected, or if
      // the current selection is no longer in the list.
      if (list.length > 0) {
        const stillValid =
          value &&
          list.some(
            (m) => m.provider === value.provider && m.id === value.model,
          );
        if (!stillValid) {
          onChange({ provider: list[0].provider, model: list[0].id });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Group models by provider for rendering, preserving canonical provider order.
  const grouped = React.useMemo(() => {
    const map = new Map<LlmProvider, LlmModelEntry[]>();
    for (const m of models) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return PROVIDER_ORDER.filter((p) => map.has(p)).map((p) => ({
      provider: p,
      items: map.get(p)!,
    }));
  }, [models]);

  const currentEncoded = value ? encode(value) : "";

  const handleChange = (enc: string) => {
    const decoded = decode(enc);
    if (decoded) onChange(decoded);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Cpu className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Select
            value={currentEncoded}
            onValueChange={handleChange}
            disabled={loading || models.length === 0}
          >
            <SelectTrigger className="pl-8">
              <SelectValue
                placeholder={
                  loading
                    ? "Loading models..."
                    : models.length === 0
                      ? "No models available"
                      : "Choose a model"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {grouped.map(({ provider, items }) => (
                <SelectGroup key={provider}>
                  <SelectLabel>{PROVIDER_LABELS[provider]}</SelectLabel>
                  {items.map((m) => (
                    <SelectItem key={encode({ provider, model: m.id })} value={encode({ provider, model: m.id })}>
                      <div className="flex w-full items-center justify-between gap-3">
                        <span className="font-mono text-xs">{m.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={load}
          disabled={loading}
          aria-label="Refresh model list"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1 leading-relaxed">
            <p className="font-medium">Could not load models</p>
            <p className="mt-0.5 text-amber-200/70">{error}</p>
          </div>
        </div>
      )}

      {!error && ollamaError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1 leading-relaxed">
            <p className="font-medium">Ollama unreachable</p>
            <p className="mt-0.5 text-amber-200/70">
              Cloud models below still work. To use local models, start the
              daemon with <code className="font-mono">ollama serve</code> and pull
              a model with <code className="font-mono">ollama pull llama3.2</code>.
              {baseUrl && (
                <>
                  {" "}
                  Trying: <span className="font-mono">{baseUrl}</span>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {!error && !loading && models.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No models available. See the provider requirements below and refresh.
        </p>
      )}

      <details className="group rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground/80 marker:hidden">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground transition-transform group-open:rotate-90">
              ▸
            </span>
            Provider requirements — switch any time
          </span>
        </summary>
        <ul className="mt-2 space-y-1.5">
          {PROVIDER_ORDER.map((p) => {
            const installed = models.some((m) => m.provider === p);
            const req = PROVIDER_REQUIREMENTS[p];
            return (
              <li key={p} className="flex items-start gap-2">
                <span
                  className={
                    "mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                    (installed
                      ? "bg-emerald-400 ring-2 ring-emerald-400/20"
                      : "bg-muted-foreground/40")
                  }
                  aria-hidden
                />
                <div>
                  <span className="font-medium text-foreground/85">
                    {req.label}
                  </span>
                  {installed && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-emerald-400/90">
                      ready
                    </span>
                  )}
                  <p className="text-muted-foreground/85">{req.requirement}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
