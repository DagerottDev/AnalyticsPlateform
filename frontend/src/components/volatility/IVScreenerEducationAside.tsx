"use client";

import { BookOpen, ExternalLink, X } from "lucide-react";

interface IVScreenerEducationAsideProps {
  onClose: () => void;
}

const sections = [
  {
    title: "1. Start with ATM IV",
    body: "ATM implied volatility is the market's annualized estimate of how much the underlying may move, derived from near-the-money options. It describes expected movement, not direction.",
  },
  {
    title: "2. Separate Rank from Percentile",
    body: "IV Rank places today's IV between its historical low and high. IV Percentile is the percentage of prior observations that were strictly below today's IV. Both are shown on a 0–100 scale, but they answer different questions.",
  },
  {
    title: "3. Check data readiness",
    body: "The screener is built from one daily ATM-IV snapshot per symbol. Rank and Percentile become meaningful after at least 20 prior observations; Building and Stale describe data coverage, not a market view.",
  },
  {
    title: "4. Compare the context",
    body: "A high rank can reflect a real event or regime change, and does not automatically mean options are expensive. Check spot, expiry, liquidity, upcoming events, and the raw ATM IV before drawing a conclusion.",
  },
];

/** Optional learning rail for the IV Screener. */
export function IVScreenerEducationAside({ onClose }: IVScreenerEducationAsideProps) {
  return (
    <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-label="IV Screener education">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--color-accent-blue)]" />
          <h2 className="font-semibold text-[var(--color-text-bright)]">How to use the IV Screener</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide IV Screener education"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        This page ranks daily implied-volatility observations across the NSE F&amp;O stock universe. It is a comparison tool, not a standalone entry or exit signal.
      </p>
      <div className="space-y-3">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs font-semibold text-[var(--color-text-bright)]">{section.title}</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{section.body}</p>
          </section>
        ))}
      </div>
      <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
        <p className="mb-2 text-xs font-semibold text-[var(--color-text-bright)]">Learn more</p>
        <a
          href="https://www.optionseducation.org/advancedconcepts/volatility-the-greeks"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Volatility and the Greeks
        </a>
      </div>
    </aside>
  );
}
