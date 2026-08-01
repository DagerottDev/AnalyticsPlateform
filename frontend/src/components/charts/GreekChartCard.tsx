"use client";

import type { ChangeEvent } from "react";
import { BellPlus } from "lucide-react";
import { GreekLineChart } from "@/components/charts/GreekLineChart";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { CORE_GREEKS_REFERENCE, GREEK_EDUCATION, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";
import type { GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import type { GreekPoint, GreekMetric } from "@/lib/strikeGreekAnalysis";

interface GreekChartCardProps {
  title: string;
  metric: GreekMetric;
  points: GreekPoint[];
  liveContracts: number;
  totalContracts: number;
  layout: GreekPanelLayout;
  onLayoutChange: (layout: GreekPanelLayout) => void;
  onRequestAlert: (metric: GreekMetric) => void;
  syncId: string;
  /** Tags this card as one of the always-visible Featured Greeks. */
  featured?: boolean;
  alertsDisabled?: boolean;
  alertDisabledReason?: string;
}

export function GreekChartCard({ title, metric, points, liveContracts, totalContracts, layout, onLayoutChange, onRequestAlert, syncId, featured, alertsDisabled = false, alertDisabledReason }: GreekChartCardProps) {
  const handleOverlayChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const overlay = event.target.value as GreekPanelLayout["overlay"];
    onLayoutChange({
      ...layout,
      overlay,
      ...(overlay === "supertrend" && layout.overlay !== "supertrend"
        ? { period: 10, multiplier: 3 }
        : {}),
    });
  };

  return (
    <section className="panel flex min-h-[360px] flex-col gap-3 p-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{title}</h2>
            {featured && <Badge tone="blue">Popular</Badge>}
            <EducationPopover title={GREEK_EDUCATION[metric].label} description={GREEK_EDUCATION[metric].description} tips={["Values are model estimates, not a guarantee of a future price move.", "This panel aggregates one contract at each selected strike."]} links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }, { label: "OIC options glossary", href: GREEKS_GLOSSARY_REFERENCE }]} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Sum of one contract at each selected strike.{liveContracts === totalContracts ? " Live quotes are included." : liveContracts > 0 ? ` Live quote coverage ${liveContracts}/${totalContracts}; waiting contracts are excluded.` : " Waiting for live option quotes."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center text-[var(--color-text-secondary)]">Overlay <EducationPopover title="Chart overlay" description="An overlay summarizes the combined Greek history on this panel. It does not change the raw Greek calculation." tips={["SMA weights every observation equally.", "EMA weights recent observations more heavily.", "Bollinger bands show a rolling average and dispersion.", "Supertrend uses ATR bands to show the selected Greek series' trend direction."]} links={[{ label: "OIC: Greeks and volatility", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]} />
            <Select value={layout.overlay} onChange={handleOverlayChange} className="ml-1 h-8 w-28 text-xs">
              <option value="none">None</option><option value="sma">SMA</option><option value="ema">EMA</option><option value="bbands">Bollinger</option><option value="supertrend">Supertrend</option>
            </Select>
          </span>
          {layout.overlay !== "none" && <label className="text-[var(--color-text-secondary)]">{layout.overlay === "supertrend" ? "ATR length" : "Length"} <Input aria-label={`${title} indicator length`} type="number" min="2" max="500" value={layout.period} onChange={(event) => onLayoutChange({ ...layout, period: Math.max(2, Math.min(500, event.target.valueAsNumber || 2)) })} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
          {(layout.overlay === "bbands" || layout.overlay === "supertrend") && <label className="text-[var(--color-text-secondary)]">{layout.overlay === "supertrend" ? "Multiplier" : "σ"} <Input aria-label={`${title} ${layout.overlay === "supertrend" ? "Supertrend multiplier" : "Bollinger multiplier"}`} type="number" min="0.1" max="10" step="0.1" value={layout.multiplier} onChange={(event) => onLayoutChange({ ...layout, multiplier: Math.max(0.1, Math.min(10, event.target.valueAsNumber || 2)) })} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
          <Button size="sm" variant="outline" onClick={() => onRequestAlert(metric)} disabled={alertsDisabled} title={alertDisabledReason ?? `Create a ${title} alert`}>
            <BellPlus className="h-3.5 w-3.5" /> Alert
          </Button>
        </div>
      </div>

      {points.length > 0 ? <GreekLineChart points={points} overlay={layout.overlay} overlayPeriod={layout.period} bollingerMultiplier={layout.multiplier} syncId={syncId} /> : <div className="flex min-h-[290px] items-center justify-center text-sm text-[var(--color-text-muted)]">No valid Greek values for this selection yet.</div>}
    </section>
  );
}
