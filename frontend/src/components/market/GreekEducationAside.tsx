"use client";

import { BookOpen, ExternalLink, X } from "lucide-react";
import { CORE_GREEKS_REFERENCE, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";

interface GreekEducationAsideProps {
  onClose: () => void;
}

const sections = [
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
    <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-label="Greek workspace education">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-[var(--color-accent-blue)]" /><h2 className="font-semibold text-[var(--color-text-bright)]">How to use this workspace</h2></div>
        <button type="button" onClick={onClose} aria-label="Hide education panel" className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-3 text-xs leading-5 text-[var(--color-text-secondary)]">Greek values are theoretical sensitivities. Use them to understand risk exposure, not as a guarantee of option-price movement.</p>
      <div className="space-y-3">
        {sections.map((section) => <section key={section.title}><h3 className="text-xs font-semibold text-[var(--color-text-bright)]">{section.title}</h3><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{section.body}</p></section>)}
      </div>
      <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
        <p className="mb-2 text-xs font-semibold text-[var(--color-text-bright)]">Learn more</p>
        <a href={CORE_GREEKS_REFERENCE} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline"><ExternalLink className="h-3 w-3" /> Understanding option Greeks</a>
        <a href={GREEKS_GLOSSARY_REFERENCE} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-[var(--color-accent-blue)] hover:underline"><ExternalLink className="h-3 w-3" /> Advanced Greeks glossary</a>
      </div>
    </aside>
  );
}
