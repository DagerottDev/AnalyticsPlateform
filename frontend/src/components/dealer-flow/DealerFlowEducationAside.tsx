"use client";

import { EducationAside } from "@/components/ui/EducationAside";

interface DealerFlowEducationAsideProps {
  onClose: () => void;
}

const SECTIONS = [
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

const LINKS = [
  { label: "Understanding option Greeks", href: "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks" },
  { label: "Volatility and the Greeks", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" },
];

/** Persistent, optional learning rail for the Dealer Flow workspace. */
export function DealerFlowEducationAside({ onClose }: DealerFlowEducationAsideProps) {
  return (
    <EducationAside
      ariaLabel="Dealer Flow education"
      closeLabel="Hide Dealer Flow education"
      title="How to use Dealer Flow"
      intro="Dealer Flow is an open-interest and option-Greeks model. It helps frame possible hedging pressure around strikes; it does not identify every dealer position or guarantee a market direction."
      sections={SECTIONS}
      links={LINKS}
      onClose={onClose}
    />
  );
}
