"use client";

import { CORE_GREEKS_REFERENCE, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";
import { EducationAside } from "@/components/ui/EducationAside";

interface GreekEducationAsideProps {
  onClose: () => void;
}

const SECTIONS = [
  {
    title: "1. Select contracts",
    body: "Choose up to 10 calls or puts from the Option Chain. Use contracts from the same expiry when comparing strike risk.",
  },
  {
    title: "2. Read the panels",
    body: "Each panel aggregates one contract at every selected strike, then shows how that combined Greek changes over time and with current quotes.",
  },
  {
    title: "3. Apply an overlay",
    body: "SMA and EMA smooth the Greek history. Bollinger bands add a rolling dispersion range. Overlays aid interpretation; they do not change the Greek calculation.",
  },
  {
    title: "4. Create an alert",
    body: "Set a threshold on the focused contract's raw Greek and choose a cooldown. Alerts are durable and evaluated server-side; they are not indicator-crossover alerts.",
  },
  {
    title: "5. Separate observation from risk",
    body: "Native panels sum one selected contract per strike. Greek scenarios live in Strategy Builder, where they apply its actual sides and quantities to scenario P&L. Market Structure is OI-based concentration and cannot reveal who is long or short, so hypothetical sign modes are explicitly conditional.",
  },
];

export function GreekEducationAside({ onClose }: GreekEducationAsideProps) {
  return (
    <EducationAside
      ariaLabel="Greek workspace education"
      closeLabel="Hide education panel"
      title="How to use this workspace"
      intro="Greek values are theoretical sensitivities. Use them to understand risk exposure, not as a guarantee of option-price movement."
      sections={SECTIONS}
      links={[
        { label: "Understanding option Greeks", href: CORE_GREEKS_REFERENCE },
        { label: "Advanced Greeks glossary", href: GREEKS_GLOSSARY_REFERENCE },
      ]}
      onClose={onClose}
    />
  );
}
