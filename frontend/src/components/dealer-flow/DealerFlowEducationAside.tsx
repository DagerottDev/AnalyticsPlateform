"use client";

import { BookOpen, ExternalLink, X } from "lucide-react";

interface DealerFlowEducationAsideProps {
  onClose: () => void;
}

const sections = [
  {
    title: "1. Choose an underlying and expiry",
    body: "Dealer Flow groups the option-chain open interest for the selected expiry. Start with the nearest expiry when you want the most responsive positioning view.",
  },
  {
    title: "2. Read the exposure profile",
    body: "GEX estimates how dealer hedging may respond to a move in the underlying. Positive and negative call/put bars show the sign convention used by this dashboard.",
  },
  {
    title: "3. Locate the important strikes",
    body: "Zero Gamma is the strike with the smallest absolute net exposure. Call Wall and Put Wall are the largest positive call and most negative put exposure levels in the selected chain.",
  },
  {
    title: "4. Compare higher-order exposure",
    body: "Vanna measures how delta changes as implied volatility changes. Charm measures how delta changes as time passes. Treat both as model-based risk signals, not predictions.",
  },
];

/** Persistent, optional learning rail for the Dealer Flow workspace. */
export function DealerFlowEducationAside({ onClose }: DealerFlowEducationAsideProps) {
  return (
    <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-label="Dealer Flow education">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--color-accent-blue)]" />
          <h2 className="font-semibold text-[var(--color-text-bright)]">How to use Dealer Flow</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide Dealer Flow education"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        Dealer Flow is an open-interest and option-Greeks model. It helps frame possible hedging pressure around strikes; it does not identify every dealer position or guarantee a market direction.
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
          href="https://www.optionseducation.org/advancedconcepts/understanding-options-greeks"
          target="_blank"
          rel="noreferrer"
          className="mb-2 flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Understanding option Greeks
        </a>
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
