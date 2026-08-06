"use client";

import { EducationAside } from "@/components/ui/EducationAside";

interface IVScreenerEducationAsideProps {
  onClose: () => void;
}

const SECTIONS = [
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
    title: "4. Project the IV range",
    body: "The range is an annualized ATM-IV estimate: spot × IV × selected sigma × √(calendar days ÷ 365). 1σ is the usual one-standard-deviation estimate; 1.5σ and 2σ show wider confidence bands. It describes movement, not direction.",
  },
  {
    title: "5. Treat event flags as a risk check",
    body: "The calendar flags announced NSE results, board meetings, dividends, splits, bonuses, buybacks, and rights issues inside your projection window. These events do not change the displayed IV range. “No announced events” does not rule out unannounced or unknown events; an unavailable calendar is shown as Unknown.",
  },
];

/** Optional learning rail for the IV Screener. */
export function IVScreenerEducationAside({ onClose }: IVScreenerEducationAsideProps) {
  return (
    <EducationAside
      ariaLabel="IV Screener education"
      closeLabel="Hide IV Screener education"
      title="How to use the IV Screener"
      intro="This page ranks daily implied-volatility observations across the NSE F&O stock universe. It is a comparison tool, not a standalone entry or exit signal."
      sections={SECTIONS}
      links={[{ label: "Volatility and the Greeks", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]}
      onClose={onClose}
    />
  );
}
