"use client";

import { BookOpen, ExternalLink, X } from "lucide-react";

interface RelativeValueEducationAsideProps {
  onClose: () => void;
}

const sections = [
  {
    title: "1. Build a comparison basket",
    body: "Add up to six underlyings from the shared watchlist. The page compares each symbol's nearest active expiry, so always check the expiry shown beside the instrument.",
  },
  {
    title: "2. Read IV and skew together",
    body: "ATM IV is the nearest-expiry at-the-money volatility. OTM put and call IV use contracts about 2% away from spot. Put-minus-call skew is positive when puts imply more volatility than calls.",
  },
  {
    title: "3. Treat GEX as a model",
    body: "Net GEX is a normalized nearest-expiry open-interest calculation using an ATM-IV gamma proxy. It helps compare the shape of the basket, but it is not a complete dealer-position estimate.",
  },
  {
    title: "4. Look for relative differences",
    body: "Richness, skew, and GEX are most useful when compared across similar snapshots. Consider expiry, liquidity, events, spot moves, and data status before treating a ranking as an opportunity.",
  },
];

/** Optional learning rail for the Relative Value workspace. */
export function RelativeValueEducationAside({ onClose }: RelativeValueEducationAsideProps) {
  return (
    <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-label="Relative Value education">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--color-accent-blue)]" />
          <h2 className="font-semibold text-[var(--color-text-bright)]">How to use Relative Value</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide Relative Value education"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        Relative Value puts volatility, skew, and modeled gamma exposure side by side so differences between underlyings are easier to inspect. It does not forecast direction by itself.
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
