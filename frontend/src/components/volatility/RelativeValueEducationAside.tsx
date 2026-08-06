"use client";

import { EducationAside } from "@/components/ui/EducationAside";

interface RelativeValueEducationAsideProps {
  onClose: () => void;
}

const SECTIONS = [
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
    <EducationAside
      ariaLabel="Relative Value education"
      closeLabel="Hide Relative Value education"
      title="How to use Relative Value"
      intro="Relative Value puts volatility, skew, and modeled gamma exposure side by side so differences between underlyings are easier to inspect. It does not forecast direction by itself."
      sections={SECTIONS}
      links={[{ label: "Volatility and the Greeks", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]}
      onClose={onClose}
    />
  );
}
