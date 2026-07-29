"use client";

import { useMemo, useState } from "react";
import { BellPlus } from "lucide-react";
import { GreekLineChart, type GreekOverlay } from "@/components/charts/GreekLineChart";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAlertStore, type AlertMetric, type AlertOperator } from "@/stores/alertStore";
import type { GreekPoint, GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { Instrument } from "@/types/market";

interface GreekChartCardProps {
  title: string;
  metric: GreekMetric;
  series: Record<string, GreekPoint[]>;
  instruments: Instrument[];
  ratio?: boolean;
}

const metricToAlert: Record<GreekMetric, AlertMetric> = {
  delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega", rho: "Rho",
  vanna: "Vanna", vomma: "Vomma", charm: "Charm", speed: "Speed", color: "Color",
  zomma: "Zomma", ultima: "Ultima",
};

function compactSymbol(symbol: string) {
  return symbol.length > 26 ? `${symbol.slice(0, 23)}…` : symbol;
}

export function GreekChartCard({ title, metric, series, instruments, ratio = false }: GreekChartCardProps) {
  const symbols = useMemo(() => Object.keys(series).filter((symbol) => series[symbol].length > 0), [series]);
  const [focusSymbol, setFocusSymbol] = useState("");
  const [overlay, setOverlay] = useState<GreekOverlay>("none");
  const [period, setPeriod] = useState(20);
  const [multiplier, setMultiplier] = useState(2);
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
          <h2 className="text-base font-semibold text-[var(--color-text-bright)]">{title}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">{ratio ? "Each contract divided by the selected base contract." : "Recomputed from matched option and underlying historical candles."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-[var(--color-text-secondary)]">Focus
            <Select value={selectedFocus} onChange={(event) => setFocusSymbol(event.target.value)} className="ml-1 h-8 max-w-48 text-xs">
              {symbols.map((symbol) => <option key={symbol} value={symbol}>{compactSymbol(symbol)}</option>)}
            </Select>
          </label>
          <label className="text-[var(--color-text-secondary)]">Overlay
            <Select value={overlay} onChange={(event) => setOverlay(event.target.value as GreekOverlay)} className="ml-1 h-8 w-28 text-xs">
              <option value="none">None</option><option value="sma">SMA</option><option value="ema">EMA</option><option value="bbands">Bollinger</option>
            </Select>
          </label>
          {overlay !== "none" && <label className="text-[var(--color-text-secondary)]">Length <Input aria-label={`${title} indicator length`} type="number" min="2" max="500" value={period} onChange={(event) => setPeriod(Math.max(2, Math.min(500, event.target.valueAsNumber || 2)))} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
          {overlay === "bbands" && <label className="text-[var(--color-text-secondary)]">σ <Input aria-label={`${title} Bollinger multiplier`} type="number" min="0.1" max="10" step="0.1" value={multiplier} onChange={(event) => setMultiplier(Math.max(0.1, Math.min(10, event.target.valueAsNumber || 2)))} className="ml-1 inline h-8 w-16 px-2 text-xs" /></label>}
        </div>
      </div>

      {symbols.length > 0 ? <GreekLineChart series={series} focusSymbol={selectedFocus} overlay={overlay} overlayPeriod={period} bollingerMultiplier={multiplier} /> : <div className="flex min-h-[290px] items-center justify-center text-sm text-[var(--color-text-muted)]">No valid historical Greek values for this selection.</div>}

      {!ratio && symbols.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-[var(--color-text-secondary)]"><BellPlus className="h-3.5 w-3.5" /> {title} alert</span>
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
