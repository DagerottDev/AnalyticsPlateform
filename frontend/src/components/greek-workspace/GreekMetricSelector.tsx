"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { CORE_GREEKS_REFERENCE, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";
import { FIRST_ORDER_GREEKS, HIGHER_ORDER_GREEKS, type GreekMetric } from "@/lib/strikeGreekAnalysis";
import { GREEK_LABEL } from "./greekLabels";

export const GREEK_METRIC_SELECTOR_TABS = [
  { id: "core", label: "Core Greeks" },
  { id: "higher-order", label: "Higher-order Greeks" },
];

interface GreekMetricSelectorProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  visibleGreeks: GreekMetric[];
  onToggle: (metric: GreekMetric) => void;
  liveCoverageLabel: string;
}

/** Tab switcher (Core / Higher-order Greeks) plus the per-Greek visibility
 * toggles for whichever tab is active. Active-tab state is client-local UI
 * state owned by the page (not persisted in the saved layout). */
export function GreekMetricSelector({ activeTab, onTabChange, visibleGreeks, onToggle, liveCoverageLabel }: GreekMetricSelectorProps) {
  const metricsForTab = activeTab === "core" ? FIRST_ORDER_GREEKS : HIGHER_ORDER_GREEKS;
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="panel flex flex-col gap-3 p-4">
      <div>
        <div className="flex items-center gap-1">
          <h2 className="font-semibold text-[var(--color-text-bright)]">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-expanded={expanded}
              aria-controls="greek-dashboard-panel-controls"
              className="focus-ring inline-flex items-center gap-1 rounded text-left"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              Dashboard panels
            </button>
          </h2>
          <EducationPopover
            title="Dashboard panels"
            description="Toggle a Greek to add or remove its chart. Each visible panel combines one contract from every selected strike into a single aggregate exposure line."
            tips={["Core Greeks describe primary sensitivities.", "Higher-order Greeks describe how those sensitivities change."]}
            links={[{ label: "OIC: Greeks and volatility", href: CORE_GREEKS_REFERENCE }, { label: "OIC options glossary", href: GREEKS_GLOSSARY_REFERENCE }]}
          />
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          {expanded
            ? `Each panel combines the selected strikes into one Greek line. Live quote coverage: ${liveCoverageLabel}.`
            : "Expand to choose which Greek charts are visible."}
        </p>
      </div>

      {expanded && (
        <div id="greek-dashboard-panel-controls">
          <Tabs tabs={GREEK_METRIC_SELECTOR_TABS} value={activeTab} onChange={onTabChange} />

          <div className="mt-3 flex flex-wrap gap-2">
            {metricsForTab.map((metric) => (
              <button
                type="button"
                key={metric}
                onClick={() => onToggle(metric)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  visibleGreeks.includes(metric)
                    ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/15 text-[var(--color-text-bright)]"
                    : "border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
                }`}
              >
                {GREEK_LABEL[metric]}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
