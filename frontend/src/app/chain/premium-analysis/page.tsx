"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Link2, RefreshCw, Save } from "lucide-react";
import type { Time } from "lightweight-charts";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { NumericParameterInput } from "@/components/charts/NumericParameterInput";
import { GreekChartSyncProvider } from "@/components/greek-workspace/GreekChartSyncProvider";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Select } from "@/components/ui/Select";
import {
  CHART_INDICATOR_DEFINITIONS,
  ChartIndicatorId,
  ChartIndicators,
  createDefaultChartIndicators,
} from "@/lib/chartIndicators";
import { combinePremiumCandles, combinedLivePremium, combineResolvedPremiumCandles, premiumStrikeSummary, resolvedLivePremium } from "@/lib/combinedPremium";
import { getHistoricalCandles, getInstruments, HistoricalCandle } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import {
  createDefaultUserPreferences,
  useSettingsStore,
  type PremiumChartSeriesType,
} from "@/stores/settingsStore";
import type { OHLCVData } from "@/lib/indicators";
import type { Instrument } from "@/types/market";
import { recentMarketDateRange } from "@/lib/recentHistory";
import { formatMarketDateTime } from "@/lib/chartTime";
import {
  buildResolvedSelectionPaths,
  currentResolvedSelections,
  instrumentsRequiredByPaths,
  MAX_ANALYSIS_SELECTIONS,
  MAX_DYNAMIC_HISTORY_CONTRACTS,
  parseDynamicSelections,
  parseFixedSelections,
  resolvedSelectionAtTime,
  resolvedSelectionLabel,
  type AnalysisSelection,
  type ResolvedSelectionPaths,
  type ResolvedOptionSelection,
} from "@/lib/analysisSelections";

const HISTORY_FETCH_CONCURRENCY = 2;
const HISTORY_DAY_OPTIONS = [2, 3] as const;
type HistoryDays = (typeof HISTORY_DAY_OPTIONS)[number];
const DEFAULT_HISTORY_DAYS: HistoryDays = 3;
const TIMEFRAME_OPTIONS = ["1", "3", "5", "10", "15"] as const;
type PremiumTimeframe = (typeof TIMEFRAME_OPTIONS)[number];
const DEFAULT_TIMEFRAME: PremiumTimeframe = "3";
const DEFAULT_WORKSPACE_PREFERENCES = createDefaultUserPreferences().combinedPremiumWorkspace;

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

function copyIndicators(indicators: ChartIndicators): ChartIndicators {
  return Object.fromEntries(Object.entries(indicators).map(([id, settings]) => [
    id,
    { ...settings, parameters: { ...settings.parameters } },
  ])) as ChartIndicators;
}

function copyPremiumIndicators(indicators: Record<PremiumGroup, ChartIndicators>): Record<PremiumGroup, ChartIndicators> {
  return {
    calls: copyIndicators(indicators.calls),
    puts: copyIndicators(indicators.puts),
    both: copyIndicators(indicators.both),
  };
}

async function fetchOptionHistory(instruments: Instrument[], from: string, to: string, resolution: PremiumTimeframe): Promise<HistoricalCandle[][]> {
  const results: HistoricalCandle[][] = Array.from({ length: instruments.length }, () => []);
  let next = 0;
  async function worker() {
    while (next < instruments.length) {
      const index = next++;
      try {
        results[index] = await getHistoricalCandles(instruments[index].trading_symbol, from, to, resolution);
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
        <NumericParameterInput
          ariaLabel={`${GROUP_LABELS[group]} ${indicator.label} ${parameter.label}`}
          value={indicators[indicator.id].parameters[parameter.key]}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          integer={parameter.step === 1}
          onValueChange={(value) => update(indicator.id, { parameters: {
              ...indicators[indicator.id].parameters,
              [parameter.key]: value,
            } })}
          className="w-14 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-1.5 py-1 text-xs text-[var(--color-text-bright)]"
        />
      </label>)}
    </div>)}
  </Card>;
}

function StrikeSummary({ group, selectionIds = [], selections, paths, currentResolutions, crosshairTime }: {
  group: PremiumGroup;
  selectionIds?: string[];
  selections: AnalysisSelection[];
  paths: ResolvedSelectionPaths;
  currentResolutions: Record<string, ResolvedOptionSelection | null>;
  crosshairTime: number | null;
}) {
  const summaries = selectionIds.flatMap((id) => {
    const selection = selections.find((item) => item.id === id);
    if (!selection) return [];
    return [{ id, summary: premiumStrikeSummary(selection, currentResolutions[id] ?? null, paths[id] ?? {}) }];
  });
  if (summaries.length === 0) return null;
  return <Card role="region" aria-label={`${GROUP_LABELS[group]} strikes shown`} className="border-[var(--color-accent-blue)]/30 bg-[var(--color-accent-blue)]/5 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-primary)]">{GROUP_LABELS[group]} · strikes shown</h3>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Now shows the live spot resolution; rolling history lists the source-strike range used across the chart.</p>
      </div>
      <span className="text-xs text-[var(--color-text-muted)]">{summaries.length} leg{summaries.length === 1 ? "" : "s"}</span>
    </div>
    <div role="list" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map(({ id, summary }) => {
        const crosshairResolution = crosshairTime === null ? null : resolvedSelectionAtTime(paths[id] ?? {}, crosshairTime);
        return <div key={id} role="listitem" className="min-w-0 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">{summary.selectionLabel}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
            <p className="min-w-0 break-words"><span className="font-medium text-[var(--color-text-primary)]">Now:</span> {summary.currentLabel}</p>
            {crosshairTime !== null && <p className="min-w-0 break-words" aria-live="polite"><span className="font-medium text-[var(--color-accent-orange)]">At crosshair ({formatMarketDateTime(crosshairTime as Time) || "selected candle"}):</span> {crosshairResolution ? resolvedSelectionLabel(crosshairResolution) : "Unavailable at this time"}</p>}
          </div>
          {summary.historicalSourceLabel && <p className="mt-1 text-[11px] text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text-secondary)]">History:</span> {summary.historicalSourceLabel}</p>}
        </div>;
      })}
    </div>
  </Card>;
}

function PremiumChart({ group, instruments, selectionIds, paths, underlyingCandles, candles, ticks, indicators, onIndicatorsChange, timeframe, syncId, selections, fixedInstruments, expiryInstruments, rollingSelectionMode, currentResolutions, crosshairTime, onCrosshairTimeChange, seriesType }: {
  group: PremiumGroup;
  instruments: Instrument[];
  selectionIds?: string[];
  paths?: ResolvedSelectionPaths;
  underlyingCandles?: HistoricalCandle[];
  candles: Record<string, HistoricalCandle[]>;
  ticks: ReturnType<typeof useMarketData>["ticks"];
  indicators: ChartIndicators;
  onIndicatorsChange: (next: ChartIndicators) => void;
  timeframe: PremiumTimeframe;
  syncId: string;
  selections: AnalysisSelection[];
  fixedInstruments: Record<string, Instrument>;
  expiryInstruments: Instrument[];
  rollingSelectionMode: "smooth" | "raw";
  currentResolutions: Record<string, ResolvedOptionSelection | null>;
  crosshairTime: number | null;
  onCrosshairTimeChange: (time: number | null) => void;
  seriesType: PremiumChartSeriesType;
}) {
  const symbols = Array.from(new Set(instruments.map((instrument) => instrument.trading_symbol)));
  const data = useMemo(() => selectionIds && paths && underlyingCandles
    ? combineResolvedPremiumCandles(selectionIds, paths, candles as Record<string, HistoricalCandle[]>, underlyingCandles, selections, fixedInstruments, expiryInstruments, rollingSelectionMode)
    : combinePremiumCandles(symbols.map((symbol) => toOhlcv(candles[symbol] || []))), [candles, symbols, selectionIds, paths, underlyingCandles, selections, fixedInstruments, expiryInstruments, rollingSelectionMode]);
  // A rolling group may be temporarily out of the expiry ladder. Do not show
  // a partial live sum while any selected component lacks a current contract.
  const premium = selectionIds
    ? selectionIds.reduce<number | null>((sum, id) => {
      const price = resolvedLivePremium(currentResolutions[id] ?? null, ticks);
      return sum === null || price === null ? null : sum + price;
    }, 0)
    : combinedLivePremium(symbols, ticks);
  const timestamp = symbols.reduce((latest, symbol) => Math.max(latest, ticks[symbol]?.timestamp || 0), 0);
  const liveTick = useMemo(
    () => premium === null ? null : { price: premium, timestamp },
    [premium, timestamp],
  );
  if ((selectionIds?.length ?? instruments.length) === 0) return <Card><EmptyState title={`No ${group === "calls" ? "Call" : "Put"} contracts selected`} description="Return to Option Chain and select the contracts to include." /></Card>;
  if (data.length === 0) return <Card><EmptyState title={`${GROUP_LABELS[group]} is unavailable`} description="Every selected component needs matching broker history for a composite candle." /></Card>;
  return <section className="flex flex-col gap-3">
    <StrikeSummary group={group} selectionIds={selectionIds} selections={selections} paths={paths ?? {}} currentResolutions={currentResolutions} crosshairTime={crosshairTime} />
    <IndicatorControls group={group} indicators={indicators} onChange={onIndicatorsChange} />
    <TradingChart
      data={data}
      indicators={indicators}
      liveTick={liveTick}
      symbol={`${GROUP_LABELS[group]} · ${selectionIds?.length ?? instruments.length} selection${(selectionIds?.length ?? instruments.length) === 1 ? "" : "s"}`}
      timeframeLabel={`${timeframe}m`}
      syncId={syncId}
      onCrosshairTimeChange={onCrosshairTimeChange}
      seriesType={seriesType}
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
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  // Do not read persisted browser settings during initial render. Next.js also
  // renders this client component on the server, where localStorage is absent;
  // using it here would let the first browser render differ from the HTML.
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [timeframe, setTimeframe] = useState<PremiumTimeframe>(
    DEFAULT_WORKSPACE_PREFERENCES.timeframe ?? DEFAULT_TIMEFRAME
  );
  const [historyDays, setHistoryDays] = useState<HistoryDays>(DEFAULT_HISTORY_DAYS);
  const [syncCharts, setSyncCharts] = useState(DEFAULT_WORKSPACE_PREFERENCES.syncCharts);
  const [seriesType, setSeriesType] = useState<PremiumChartSeriesType>(
    DEFAULT_WORKSPACE_PREFERENCES.seriesType
  );
  const [indicators, setIndicators] = useState<Record<PremiumGroup, ChartIndicators>>(() =>
    copyPremiumIndicators(DEFAULT_WORKSPACE_PREFERENCES.indicators ?? {
      calls: initialIndicators(), puts: initialIndicators(), both: initialIndicators(),
    })
  );
  const [layoutMessage, setLayoutMessage] = useState("");
  const workspacePreferences = useSettingsStore((state) => state.combinedPremiumWorkspace);
  const persistedRollingSelectionMode = useSettingsStore(
    (state) => state.optionChain.rollingSelectionMode
  );
  const updatePreferences = useSettingsStore((state) => state.updatePreferences);
  const rollingSelectionMode = preferencesReady
    ? persistedRollingSelectionMode
    : "smooth";

  useEffect(() => {
    setTimeframe(workspacePreferences.timeframe ?? DEFAULT_TIMEFRAME);
    setSyncCharts(workspacePreferences.syncCharts);
    setSeriesType(workspacePreferences.seriesType);
    setIndicators(copyPremiumIndicators(workspacePreferences.indicators));
    setPreferencesReady(true);
  }, [workspacePreferences]);

  const load = useCallback(async () => {
    setCrosshairTime(null);
    if (!symbol || selections.length === 0) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await getInstruments(symbol);
      const contracts = response.instruments.filter((instrument) => !expiry || instrument.expiry === expiry);
      const fixedBySymbol = Object.fromEntries(contracts.map((instrument) => [instrument.trading_symbol, instrument]));
      const { from, to } = recentMarketDateRange(new Date(), historyDays);
      const underlying = await getHistoricalCandles(symbol, from, to, timeframe);
      const resolvedPaths = buildResolvedSelectionPaths(selections, fixedBySymbol, contracts, underlying, rollingSelectionMode);
      const required = instrumentsRequiredByPaths(resolvedPaths, selections, fixedBySymbol, contracts, underlying, rollingSelectionMode);
      if (required.length > MAX_DYNAMIC_HISTORY_CONTRACTS) throw new Error(`Rolling selection needs ${required.length} source contracts; the maximum is ${MAX_DYNAMIC_HISTORY_CONTRACTS}. Reduce selections or switch to Raw rolling mode.`);
      const histories = await fetchOptionHistory(required, from, to, timeframe);
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
  }, [expiry, fixedSelections, historyDays, rollingSelectionMode, selections, symbol, timeframe]);

  useEffect(() => { void load(); }, [load]);
  const { ticks: underlyingTicks } = useMarketData(symbol ? [symbol] : []);
  const spot = underlyingTicks[symbol]?.last_price ?? underlyingCandles[underlyingCandles.length - 1]?.close ?? 0;
  const fixedBySymbol = useMemo(() => Object.fromEntries(selected.map((item) => [item.trading_symbol, item])), [selected]);
  const currentResolved = useMemo(() => currentResolvedSelections(selections, fixedBySymbol, expiryInstruments, spot, rollingSelectionMode), [selections, fixedBySymbol, expiryInstruments, spot, rollingSelectionMode]);
  const liveSymbols = useMemo(() => Array.from(new Set(Object.values(currentResolved).flatMap((resolution) => resolution?.components.map(({ instrument }) => instrument.trading_symbol) ?? []))), [currentResolved]);
  const { ticks: optionTicks } = useMarketData(liveSymbols);
  const ticks = useMemo(() => ({ ...underlyingTicks, ...optionTicks }), [underlyingTicks, optionTicks]);
  const callIds = useMemo(() => selections.filter((selection) => selection.kind === "dynamic" ? selection.optionType === "CE" : selected.find((item) => item.trading_symbol === selection.tradingSymbol)?.option_type === "CE").map((selection) => selection.id), [selections, selected]);
  const putIds = useMemo(() => selections.filter((selection) => selection.kind === "dynamic" ? selection.optionType === "PE" : selected.find((item) => item.trading_symbol === selection.tradingSymbol)?.option_type === "PE").map((selection) => selection.id), [selections, selected]);
  const currentInstruments = useMemo(() => Object.values(currentResolved).flatMap((resolution) => resolution?.components.map(({ instrument }) => instrument) ?? []), [currentResolved]);

  const calls = currentInstruments.filter((instrument) => instrument.option_type === "CE");
  const puts = currentInstruments.filter((instrument) => instrument.option_type === "PE");
  const saveLayout = () => {
    updatePreferences((current) => ({
      ...current,
      combinedPremiumWorkspace: { timeframe, syncCharts, seriesType, indicators: copyPremiumIndicators(indicators) },
    }));
    setLayoutMessage("Layout saved to your profile. It will load for your next combined-premium analysis.");
  };
  return <DashboardLayout sidebarCollapsed><div className="mx-auto flex max-w-[1800px] flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold text-[var(--color-text-bright)]">Combined Premium Analysis</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{symbol} {expiry ? `· ${expiry}` : ""} · {historyDays}-session history + live premium, {timeframe}-minute synthetic candles from selected option premiums.</p>{layoutMessage && <p className="mt-1 text-xs text-[var(--color-profit)]" role="status">{layoutMessage}</p>}</div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => window.close()}><ArrowLeft className="h-4 w-4" /> Close window</Button><Button variant="outline" size="sm" onClick={saveLayout}><Save className="h-4 w-4" /> Save layout</Button><Button variant="secondary" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button></div></div>
    <Card className="flex flex-wrap items-end justify-between gap-4"><div className="flex flex-wrap items-end gap-4"><label className="text-sm text-[var(--color-text-primary)]">Historical sessions<span className="mt-1 block text-xs text-[var(--color-text-secondary)]">Loads completed market sessions plus the current session for indicator warm-up.</span><Select aria-label="Combined premium historical sessions" className="mt-2 h-8 w-32 text-xs" value={String(historyDays)} onChange={(event) => setHistoryDays(Number(event.target.value) as HistoryDays)}>{HISTORY_DAY_OPTIONS.map((value) => <option key={value} value={value}>{value} sessions</option>)}</Select></label><label className="text-sm text-[var(--color-text-primary)]">Candle timeframe<span className="mt-1 block text-xs text-[var(--color-text-secondary)]">Reloads all three composites using the selected broker candle resolution.</span><Select aria-label="Combined premium timeframe" className="mt-2 h-8 w-32 text-xs" value={timeframe} onChange={(event) => setTimeframe(event.target.value as PremiumTimeframe)}>{TIMEFRAME_OPTIONS.map((value) => <option key={value} value={value}>{value} minute{value === "1" ? "" : "s"}</option>)}</Select></label><label className="text-sm text-[var(--color-text-primary)]">Chart style<Select aria-label="Combined premium chart style" className="mt-2 h-8 w-40 text-xs" value={seriesType} onChange={(event) => setSeriesType(event.target.value as PremiumChartSeriesType)}><option value="candlestick">Candlesticks</option><option value="line">Close-price line</option></Select></label><Button variant={rollingSelectionMode === "smooth" ? "primary" : "outline"} size="sm" disabled={dynamicSelections.length === 0} onClick={() => updatePreferences((current) => ({ ...current, optionChain: { ...current.optionChain, rollingSelectionMode: current.optionChain.rollingSelectionMode === "smooth" ? "raw" : "smooth" } }))} title={dynamicSelections.length ? "Smooth blends adjacent strikes by distance; Raw uses one exact rolled contract." : "Add a rolling ATM/OTM/ITM selection to change this mode."}>{rollingSelectionMode === "smooth" ? "Smooth rolling" : "Raw rolling"}</Button><Button variant={syncCharts ? "primary" : "outline"} size="sm" onClick={() => setSyncCharts((current) => !current)} aria-pressed={syncCharts} title="Synchronize the visible time window, horizontal zoom, and crosshair across all premium charts"><Link2 className="h-4 w-4" /> {syncCharts ? "Charts synced" : "Sync charts"}</Button></div><p className="max-w-xl text-xs leading-5 text-[var(--color-text-secondary)]">Close-price line uses the close from each synthetic candle. With chart sync enabled, moving the pointer also aligns the crosshair time across Calls, Puts, and Calls + Puts. Save layout stores this style, timeframe, chart sync, and each group’s indicators in your profile.</p></Card>
    <Card className="border-[var(--color-accent-orange)]/40 bg-[var(--color-accent-orange)]/5"><p className="text-xs text-[var(--color-text-secondary)]">Composite OHLC values are sums of matching option premiums. Smooth rolling blends adjacent strikes by underlying distance and is synthetic analytics, not an exchange-traded instrument.</p></Card>
    {loading ? <Card><LoadingState size="lg" label="Loading selected option histories…" /></Card> : error ? <Card className="flex flex-col gap-3"><EmptyState title="Could not load combined premium history" /><ApiErrorDisplay error={error} /></Card> : selections.length === 0 ? <Card><EmptyState title="Select Option Chain contracts first" description="Choose up to ten call/put contracts in the Option Chain, then open Combined Premium." /></Card> : <GreekChartSyncProvider enabled={syncCharts}><div className="flex flex-col gap-6"><PremiumChart group="calls" syncId="combined-premium-calls" timeframe={timeframe} instruments={calls} selectionIds={callIds} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.calls} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, calls: next }))} selections={selections} fixedInstruments={fixedBySymbol} expiryInstruments={expiryInstruments} rollingSelectionMode={rollingSelectionMode} currentResolutions={currentResolved} crosshairTime={crosshairTime} onCrosshairTimeChange={setCrosshairTime} seriesType={seriesType} /><PremiumChart group="puts" syncId="combined-premium-puts" timeframe={timeframe} instruments={puts} selectionIds={putIds} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.puts} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, puts: next }))} selections={selections} fixedInstruments={fixedBySymbol} expiryInstruments={expiryInstruments} rollingSelectionMode={rollingSelectionMode} currentResolutions={currentResolved} crosshairTime={crosshairTime} onCrosshairTimeChange={setCrosshairTime} seriesType={seriesType} /><PremiumChart group="both" syncId="combined-premium-both" timeframe={timeframe} instruments={currentInstruments} selectionIds={selections.map((selection) => selection.id)} paths={paths} underlyingCandles={underlyingCandles} candles={candles} ticks={ticks} indicators={indicators.both} onIndicatorsChange={(next) => setIndicators((current) => ({ ...current, both: next }))} selections={selections} fixedInstruments={fixedBySymbol} expiryInstruments={expiryInstruments} rollingSelectionMode={rollingSelectionMode} currentResolutions={currentResolved} crosshairTime={crosshairTime} onCrosshairTimeChange={setCrosshairTime} seriesType={seriesType} /></div></GreekChartSyncProvider>}
  </div></DashboardLayout>;
}

export default function CombinedPremiumAnalysisPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-[var(--color-text-muted)]">Loading combined premium analysis…</div>}><PremiumAnalysisWorkspace /></Suspense>;
}
