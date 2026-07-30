"use client";

import { useMemo, useState } from "react";
import { BellPlus } from "lucide-react";
import { GreekLineChart } from "@/components/charts/GreekLineChart";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { CORE_GREEKS_REFERENCE, GREEK_EDUCATION, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";
import type { GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import { useAlertStore, type AlertMetric, type AlertOperator } from "@/stores/alertStore";
import type { GreekPoint, GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { Instrument } from "@/types/market";

interface GreekChartCardProps {
  title: string;
  metric: GreekMetric;
  points: GreekPoint[];
  instruments: Instrument[];
  liveContracts: number;
  totalContracts: number;
  layout: GreekPanelLayout;
  onLayoutChange: (layout: GreekPanelLayout) => void;
}

const metricToAlert: Record<GreekMetric, AlertMetric> = {
  delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega", rho: "Rho",
  vanna: "Vanna", vomma: "Vomma", charm: "Charm", speed: "Speed", color: "Color",
  zomma: "Zomma", ultima: "Ultima",
};

function compactSymbol(symbol: string) {
  return symbol.length > 26 ? `${symbol.slice(0, 23)}…` : symbol;
}

export function GreekChartCard({ title, metric, points, instruments, liveContracts, totalContracts, layout, onLayoutChange }: GreekChartCardProps) {
  const symbols = useMemo(() => instruments.map((instrument) => instrument.trading_symbol), [instruments]);
  const [focusSymbol, setFocusSymbol] = useState("");
  const [operator, setOperator] = useState<AlertOperator>(">");
  const [threshold, setThreshold] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState(15);
  const [alertError, setAlertError] = useState<unknown>(null);
  const [alertMessage, setAlertMessage] = useState("");
  const { addAlert } = useAlertStore();
  const selectedFocus = symbols.includes(focusSymbol) ? focusSymbol : (symbols[0] ?? "");

  const createAlert = async () => {
    const instrument = instruments.find((item) => item.trading_symbol === selectedFocus);
    const numericThreshold = Number(threshold);
    if (!instrument || !Number.isFinite(numericThreshold)) return;
    setAlertError(null);
    setAlertMessage("");
    try {
      await addAlert({
        instrument,
        metric: metricToAlert[metric],
        operator,
        threshold: numericThreshold,
        cooldownMinutes,
      });
      setAlertMessage(`${title} alert saved for ${compactSymbol(instrument.trading_symbol)}.`);
      setThreshold("");
    } catch (error) {
      setAlertError(error);
    }
  };

  return (
    <section className="panel flex min-h-[410px] flex-col gap-3 p-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{title}</h2>
            <EducationPopover title={GREEK_EDUCATION[metric].label} description={GREEK_EDUCATION[metric].description} tips={["Values are model estimates, not a guarantee of a future price move.", "This panel aggregates one contract at each selected strike."]} links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }, { label: "OIC options glossary", href: GREEKS_GLOSSARY_REFERENCE }]} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Sum of one contract at each selected strike.{liveContracts === totalContracts ? " Live quotes are included." : liveContracts > 0 ? ` Live quote coverage ${liveContracts}/${totalContracts}; waiting contracts are excluded.` : " Waiting for live option quotes."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-[var(--color-text-secondary)]">Alert contract
            <Select value={selectedFocus} onChange={(event) => setFocusSymbol(event.target.value)} className="ml-1 h-8 max-w-48 text-xs">
              {symbols.map((symbol) => <option key={symbol} value={symbol}>{compactSymbol(symbol)}</option>)}
            </Select>
          </label>
          <span className="flex items-center text-[var(--color-text-secondary)]">Overlay <EducationPopover title="Chart overlay" description="An overlay summarizes the combined Greek history on this panel. It does not change the raw Greek calculation." tips={["SMA weights every observation equally.", "EMA weights recent observations more heavily.", "Bollinger bands show a rolling average and dispersion."]} links={[{ label: "OIC: Greeks and volatility", href: "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks" }]} />
            <Select value={layout.overlay} onChange={(event) => onLayoutChange({ ...layout, overlay: event.target.value as GreekPanelLayout["overlay"] })} className="ml-1 h-8 w-28 text-xs">
              <option value="none">None</option><option value="sma">SMA</option><option value="ema">EMA</option><option value="bbands">Bollinger</option>
            </Select>
          </span>
          {layout.overlay !== "none" && <label className="text-[var(--color-text-secondary)]">Length <Input aria-label={`${title} indicator length`} type="number" min="2" max="500" value={layout.period} onChange={(event) => onLayoutChange({ ...layout, period: Math.max(2, Math.min(500, event.target.valueAsNumber || 2)) })} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
          {layout.overlay === "bbands" && <label className="text-[var(--color-text-secondary)]">σ <Input aria-label={`${title} Bollinger multiplier`} type="number" min="0.1" max="10" step="0.1" value={layout.multiplier} onChange={(event) => onLayoutChange({ ...layout, multiplier: Math.max(0.1, Math.min(10, event.target.valueAsNumber || 2)) })} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
        </div>
      </div>

      {points.length > 0 ? <GreekLineChart points={points} overlay={layout.overlay} overlayPeriod={layout.period} bollingerMultiplier={layout.multiplier} /> : <div className="flex min-h-[290px] items-center justify-center text-sm text-[var(--color-text-muted)]">No valid Greek values for this selection yet.</div>}

      {symbols.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-[var(--color-text-secondary)]"><BellPlus className="h-3.5 w-3.5" /> {title} alert <EducationPopover title={`${title} threshold alert`} description="Creates a durable server-side alert for the selected contract's current Greek value. It evaluates the raw Greek, not an SMA, EMA, or Bollinger crossover." tips={["Choose the comparison and threshold.", "Cooldown limits repeat notifications after a trigger."]} links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }]} /></span>
            <Select aria-label={`${title} alert operator`} value={operator} onChange={(event) => setOperator(event.target.value as AlertOperator)} className="h-8 w-16 text-xs"><option value=">">&gt;</option><option value="<">&lt;</option><option value=">=">≥</option><option value="<=">≤</option></Select>
            <Input aria-label={`${title} alert threshold`} type="number" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Threshold" className="h-8 w-28 px-2 text-xs" />
            <Input aria-label={`${title} alert cooldown`} type="number" min="0" value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Math.max(0, event.target.valueAsNumber || 0))} className="h-8 w-20 px-2 text-xs" title="Cooldown in minutes" />
            <Button size="sm" variant="outline" onClick={createAlert} disabled={!threshold || !selectedFocus}><BellPlus className="h-3.5 w-3.5" /> Alert</Button>
            <span className="text-[10px] text-[var(--color-text-muted)]">Cooldown (min)</span>
          </div>
          {alertMessage && <p className="mt-2 text-xs text-[var(--color-profit)]">{alertMessage}</p>}
          {alertError !== null && <ApiErrorDisplay error={alertError} className="mt-2" />}
        </div>
      )}
    </section>
  );
}
