"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  CHART_INDICATOR_DEFINITIONS,
  ChartIndicatorId,
  ChartIndicators,
  createDefaultChartIndicators,
} from "@/lib/chartIndicators";
import { combinePremiumCandles, combinedLivePremium, combineResolvedPremiumCandles } from "@/lib/combinedPremium";
import { getHistoricalCandles, getInstruments, HistoricalCandle } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import type { OHLCVData } from "@/lib/indicators";
import type { Instrument } from "@/types/market";
import { recentMarketDateRange } from "@/lib/recentHistory";
import {
  buildResolvedSelectionPaths,
  currentResolvedInstruments,
  instrumentsRequiredByPaths,
  MAX_ANALYSIS_SELECTIONS,
  MAX_DYNAMIC_HISTORY_CONTRACTS,
  parseDynamicSelections,
  parseFixedSelections,
  type AnalysisSelection,
  type ResolvedSelectionPaths,
} from "@/lib/analysisSelections";

const HISTORY_FETCH_CONCURRENCY = 2;
const HISTORY_DAYS = 5;
const HISTORY_RESOLUTION = "5";

type PremiumGroup = "calls" | "puts" | "both";

const GROUP_LABELS: Record<PremiumGroup, string> = {
  calls: "Combined Calls Premium",
  puts: "Combined Puts Premium",
  both: "Combined Calls + Puts Premium",
};

function initialIndicators(): ChartIndicators {
  const indicators = createDefaultChartIndicators();
  indicators.ema.enabled = true;
  return indicators;
}

function historyRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - HISTORY_DAYS);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function fetchOptionHistory(instruments: Instrument[], from: string, to: string): Promise<HistoricalCandle[][]> {
  const results: HistoricalCandle[][] = Array.from({ length: instruments.length }, () => []);
  let next = 0;
  async function worker() {
    while (next < instruments.length) {
      const index = next++;
      try {
        results[index] = await getHistoricalCandles(instruments[index].trading_symbol, from, to, HISTORY_RESOLUTION);
      } catch {
        // A single contract with no broker history should produce an explicit
        // empty composite, not prevent the other premium groups from loading.
        results[index] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(HISTORY_FETCH_CONCURRENCY, instruments.length) }, () => worker()));
  return results;
}

function toOhlcv(candles: HistoricalCandle[]): OHLCVData[] {
  return candles.map((candle) => ({
    time: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function IndicatorControls({ group, indicators, onChange }: {
  group: PremiumGroup;
  indicators: ChartIndicators;
  onChange: (next: ChartIndicators) => void;
}) {
  const update = (id: ChartIndicatorId, patch: Partial<ChartIndicators[ChartIndicatorId]>) => onChange({
    ...indicators,
    [id]: { ...indicators[id], ...patch },
  });
  return <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
    <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{GROUP_LABELS[group]} indicators:</span>
    {CHART_INDICATOR_DEFINITIONS.map((indicator) => <div key={indicator.id} className="flex items-center gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <input
          type="checkbox"
          checked={indicators[indicator.id].enabled}
          onChange={() => update(indicator.id, { enabled: !indicators[indicator.id].enabled })}
          className="accent-[var(--color-accent-blue)]"
        />
        {indicator.label}
      </label>
      {indicators[indicator.id].enabled && indicator.parameters.map((parameter) => <label key={parameter.key} className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <span>{parameter.label}</span>
        <input
          aria-label={`${GROUP_LABELS[group]} ${indicator.label} ${parameter.label}`}
          type="number"
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={indicators[indicator.id].parameters[parameter.key]}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (!Number.isFinite(value)) return;
            update(indicator.id, { parameters: {
              ...indicators[indicator.id].parameters,
              [parameter.key]: Math.min(parameter.max, Math.max(parameter.min, value)),
            } });
          }}
          className="w-14 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-1.5 py-1 text-xs text-[var(--color-text-bright)]"
        />
      </label>)}
    </div>)}
  </Card>;
}

function PremiumChart({ group, instruments, selectionIds, paths, underlyingCandles, candles, ticks, indicators, onIndicatorsChange }: {
  group: PremiumGroup;
  instruments: Instrument[];
  selectionIds?: string[];
  paths?: ResolvedSelectionPaths;
  underlyingCandles?: HistoricalCandle[];
  candles: Record<string, HistoricalCandle[]>;
  ticks: ReturnType<typeof useMarketData>["ticks"];
  indicators: ChartIndicators;
  onIndicatorsChange: (next: ChartIndicators) => void;
}) {
  const symbols = instruments.map((instrument) => instrument.trading_symbol);
  const data = useMemo(() => selectionIds && paths && underlyingCandles
    ? combineResolvedPremiumCandles(selectionIds, paths, candles as Record<string, HistoricalCandle[]>, underlyingCandles)
    : combinePremiumCandles(symbols.map((symbol) => toOhlcv(candles[symbol] || []))), [candles, symbols, selectionIds, paths, underlyingCandles]);
  // A rolling group may be temporarily out of the expiry ladder. Do not show
  // a partial live sum while any selected component lacks a current contract.
  const premium = selectionIds && symbols.length !== selectionIds.length ? null : combinedLivePremium(symbols, ticks);
  const timestamp = symbols.reduce((latest, symbol) => Math.max(latest, ticks[symbol]?.timestamp || 0), 0);
  if (instruments.length === 0) return <Card><EmptyState title={`No ${group === "calls" ? "Call" : "Put"} contracts selected`} description="Return to Option Chain and select the contracts to include." /></Card>;
  if (data.length === 0) return <Card><EmptyState title={`${GROUP_LABELS[group]} is unavailable`} description="Every selected component needs matching broker history for a composite candle." /></Card>;
  return <section className="flex flex-col gap-3">
    <IndicatorControls group={group} indicators={indicators} onChange={onIndicatorsChange} />
    <TradingChart
      data={data}
      indicators={indicators}
      liveTick={premium === null ? null : { price: premium, timestamp }}
      symbol={`${GROUP_LABELS[group]} · ${instruments.length} contract${instruments.length === 1 ? "" : "s"}`}
      timeframeLabel="5m"
    />
  </section>;
}

function PremiumAnalysisWorkspace() {
  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") || "";
  const expiry = searchParams.get("expiry") || "";
  const fixedSelections = useMemo(() => parseFixedSelections(searchParams.get("contracts")), [searchParams]);
  const dynamicSelections = useMemo(() => parseDynamicSelections(searchParams.get("dynamic")), [searchParams]);
  const selections = useMemo<AnalysisSelection[]>(() => [...fixedSelections, ...dynamicSelections].slice(0, MAX_ANALYSIS_SELECTIONS), [fixedSelections, dynamicSelections]);
  const [selected, setSelected] = useState<Instrument[]>([]);
  const [expiryInstruments, setExpiryInstruments] = useState<Instrument[]>([]);
  const [paths, setPaths] = useState<ResolvedSelectionPaths>({});
  const [underlyingCandles, setUnderlyingCandles] = useState<HistoricalCandle[]>([]);
  const [candles, setCandles] = useState<Record<string, HistoricalCandle[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [indicators, setIndicators] = useState<Record<PremiumGroup, ChartIndicators>>(() => ({
    calls: initialIndicators(), puts: initialIndicators(), both: initialIndicators(),
  }));

  const load = useCallback(async () => {
    if (!symbol || selections.length === 0) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await getInstruments(symbol);
      const contracts = response.instruments.filter((instrument) => !expiry || instrument.expiry === expiry);
      const fixedBySymbol = Object.fromEntries(contracts.map((instrument) => [instrument.trading_symbol, instrument]));
      const { from, to } = dynamicSelections.length ? recentMarketDateRange() : historyRange();
      const underlying = await getHistoricalCandles(symbol, from, to, HISTORY_RESOLUTION);
      const resolvedPaths = buildResolvedSelectionPaths(selections, fixedBySymbol, contracts, underlying);
      const required = instrumentsRequiredByPaths(resolvedPaths);
      if (required.length > MAX_DYNAMIC_HISTORY_CONTRACTS) throw new Error(`Rolling selection needs ${required.length} source contracts; the maximum is ${MAX_DYNAMIC_HISTORY_CONTRACTS}.`);
      const histories = await fetchOptionHistory(required, from, to);
      setSelected(fixedSelections.flatMap((selection) => fixedBySymbol[selection.tradingSymbol] ? [fixedBySymbol[selection.tradingSymbol]] : []));
      setExpiryInstruments(contracts);
      setPaths(resolvedPaths);
      setUnderlyingCandles(underlying);
      setCandles(Object.fromEntries(required.map((instrument, index) => [instrument.trading_symbol, histories[index] ?? []])));
    } catch (loadError) {
      setSelected([]);
      setExpiryInstruments([]);
      setPaths({});
      setUnderlyingCandles([]);
      setCandles({});
      setError(loadError);
    } finally { setLoading(false); }
  }, [dynamicSelections.length, expiry, fixedSelections, selections, symbol]);

  useEffect(() => { void load(); }, [load]);
  const { ticks: underlyingTicks } = useMarketData(symbol ? [symbol] : []);
  const spot = underlyingTicks[symbol]?.last_price ?? underlyingCandles[underlyingCandles.length - 1]?.close ?? 0;
  const currentResolved = useMemo(() => currentResolvedInstruments(selections, Object.fromEntries(selected.map((item) => [item.trading_symbol, item])), expiryInstruments, spot), [selections, selected, expiryInstruments, spot]);
  const liveSymbols = useMemo(() => Object.values(currentResolved).flatMap((instrument) => instrument ? [instrument.trading_symbol] : []), [currentResolved]);
  const { ticks: optionTicks } = useMarketData(liveSymbols);
  const ticks = useMemo(() => ({ ...underlyingTicks, ...optionTicks }), [underlyingTicks, optionTicks]);
  const callIds = useMemo(() => selections.filter((selection) => selection.kind === "dynamic" ? selection.optionType === "CE" : selected.find((item) => item.trading_symbol === selection.tradingSymbol)?.option_type === "CE").map((selection) => selection.id), [selections, selected]);
  const putIds = useMemo(() => selections.filter((selection) => selection.kind === "dynamic" ? selection.optionType === "PE" : selected.find((item) => item.trading_symbol === selection.tradingSymbol)?.option_type === "PE").map((selection) => selection.id), [selections, selected]);
  const currentInstruments = useMemo(() => Object.values(currentResolved).flatMap((instrument) => instrument ? [instrument] : []), [currentResolved]);

  const calls = currentInstruments.filter((instrument) => instrument.option_type === "CE");
  const puts = currentInstruments.filter((instrument) => instrument.option_type === "PE");
  return <DashboardLayout><div className="mx-auto flex max-w-[1800px] flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold text-[var(--color-text-bright)]">Combined Premium Analysis</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{symbol} {expiry ? `· ${expiry}` : ""} · {dynamicSelections.length ? "current-session" : "5-day"}, 5-minute synthetic candles from selected option premiums.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => window.close()}><ArrowLeft className="h-4 w-4" /> Close window</Button><Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button></div></div>
    <Card className="border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5"><p className="text-xs text-[var(--color-text-secondary)]">Composite OHLC values are sums of each selected contract’s matching 5-minute premium candle. They are derived analytics, not exchange-traded instruments.</p></Card>
    {loading ? <Card><LoadingState size="lg" label="Loading selected option histories…" /></Card> : error ? <Card className="flex flex-col gap-3"><EmptyState title="Could not load combined premium history" /><ApiErrorDisplay error={error} /></Card> : selections.length === 0 ? <Card><EmptyState title="Select Option Chain contracts first" description="Choose up to ten call/put contracts in the Option Chain, then open Combined Premium." /></Card> : <div className="flex flex-col gap-6"><PremiumChart group="calls" instruments={calls} selectionIds={callIds} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.calls} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, calls: next }))} /><PremiumChart group="puts" instruments={puts} selectionIds={putIds} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.puts} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, puts: next }))} /><PremiumChart group="both" instruments={currentInstruments} selectionIds={selections.map((selection) => selection.id)} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.both} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, both: next }))} /></div>}
  </div></DashboardLayout>;
}

export default function CombinedPremiumAnalysisPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-[var(--color-text-muted)]">Loading combined premium analysis…</div>}><PremiumAnalysisWorkspace /></Suspense>;
}
