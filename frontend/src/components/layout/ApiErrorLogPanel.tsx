"use client";

/**
 * ApiErrorLogPanel — global, always-mounted floating log of every failed
 * API request (from the axios response interceptor in lib/api.ts), so a
 * failure is never lost even if the page that triggered it doesn't show
 * its own inline error. Each entry — and the whole log — can be copied.
 */

import { useState } from "react";
import { AlertTriangle, Check, Copy, Trash2, X } from "lucide-react";
import { useApiErrorLogStore, type ApiErrorLogEntry } from "@/stores/apiErrorLogStore";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour12: false });
}

function entryToText(entry: ApiErrorLogEntry): string {
  return `[${formatTime(entry.timestamp)}] ${entry.method} ${entry.url} — ${entry.status ?? "no response"}\n${entry.detail}`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 rounded bg-[var(--color-bg-hover)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border-default)] hover:text-[var(--color-text-bright)]"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function ApiErrorLogPanel() {
  const { errors, dismiss, clear } = useApiErrorLogStore();
  const [open, setOpen] = useState(false);

  const copyAllText = errors.map(entryToText).join("\n\n");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="API failure log"
        className={cn(
          "fixed bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg transition-colors",
          errors.length > 0
            ? "border-[var(--color-status-critical)]/40 bg-[var(--color-status-critical)]/15 text-[var(--color-status-critical)] hover:bg-[var(--color-status-critical)]/25"
            : "border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        )}
      >
        <AlertTriangle className="h-4 w-4" />
        {errors.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-status-critical)] px-1 text-[10px] font-bold text-white">
            {errors.length > 99 ? "99+" : errors.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--color-status-critical)]" />
                <h2 className="text-sm font-bold text-[var(--color-text-bright)]">API Failures</h2>
                <span className="rounded-full bg-[var(--color-bg-hover)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">
                  {errors.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {errors.length > 0 && (
                  <>
                    <CopyButton text={copyAllText} label="Copy All" />
                    <Button variant="icon" size="sm" title="Clear all" onClick={clear}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button variant="icon" size="sm" title="Close" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {errors.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--color-text-muted)]">
                  <AlertTriangle className="h-6 w-6 opacity-40" />
                  <p className="text-xs">No API failures logged this session.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {errors.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="tnum text-[var(--color-text-muted)]">{formatTime(entry.timestamp)}</span>
                          <span className="rounded bg-[var(--color-bg-hover)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-text-secondary)]">
                            {entry.method}
                          </span>
                          <span className="rounded bg-[var(--color-status-critical)]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-status-critical)]">
                            {entry.status ?? "NO RESPONSE"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismiss(entry.id)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-bright)]"
                          title="Dismiss"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="mt-1.5 break-all font-mono text-[11px] text-[var(--color-text-secondary)]">
                        {entry.url}
                      </p>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-primary)] p-2 font-mono text-[11px] text-[var(--color-text-primary)]">
                        {entry.detail || entry.message}
                      </pre>
                      <div className="mt-2 flex justify-end">
                        <CopyButton text={entryToText(entry)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
