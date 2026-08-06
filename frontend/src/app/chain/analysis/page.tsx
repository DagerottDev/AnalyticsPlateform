"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { GreekEducationAside } from "@/components/market/GreekEducationAside";
import { WorkspaceHeader } from "@/components/greek-workspace/WorkspaceHeader";
import { WorkspaceSummaryStrip } from "@/components/greek-workspace/WorkspaceSummaryStrip";
import { GreekMetricSelector } from "@/components/greek-workspace/GreekMetricSelector";
import { GreekPanelSection } from "@/components/greek-workspace/GreekPanelSection";
import { CreateGreekAlertModal } from "@/components/greek-workspace/CreateGreekAlertModal";
import { GreekChartSyncProvider } from "@/components/greek-workspace/GreekChartSyncProvider";
import { SelectedStrikesCard } from "@/components/greek-workspace/SelectedStrikesCard";
import { DEFAULT_GREEK_PANEL_LAYOUT, saveGreekWorkspaceLayout, type GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import { getHistoricalCandles, getInstruments, type HistoricalCandle } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { useReplayStore } from "@/stores/replayStore";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { daysToExpiry, defaultSpotFallback, nearestStrikeTo, timeToExpiry } from "@/lib/optionMath";
import { createDefaultUserPreferences, DEFAULT_RATE_SYMBOL, useSettingsStore } from "@/stores/settingsStore";
import { recentMarketDateRange } from "@/lib/recentHistory";
import { appendLiveGreekValues, buildReplayResolvedGreekSeries, buildResolvedGreekSeries, calculateLiveResolvedGreeks, combineGreekSeries, FIRST_ORDER_GREEKS, HIGHER_ORDER_GREEKS, type GreekMetric } from "@/lib/strikeGreekAnalysis";
import {
  buildResolvedSelectionPaths,
  currentResolvedSelections,
  instrumentsRequiredByPaths,
  MAX_ANALYSIS_SELECTIONS,
  MAX_DYNAMIC_HISTORY_CONTRACTS,
  parseDynamicSelections,
  parseFixedSelections,
  dynamicSelectionLabel,
  type AnalysisSelection,
  type ResolvedSelectionPaths,
} from "@/lib/analysisSelections";
import type { Instrument, MarketTick } from "@/types/market";

// The broker's history endpoint is much more tightly rate-limited than the
// websocket stream. Keep the analysis workspace deliberately gentle so
// opening it never competes with the already-open option chain's live feed.
const HISTORY_FETCH_CONCURRENCY = 2;

// Persisted settings are rehydrated from localStorage on the browser, while
// the server can only render the built-in defaults. Keep the first render
// deterministic on both sides and apply persisted values in an effect below.
const DEFAULT_GREEK_WORKSPACE_PREFERENCES = createDefaultUserPreferences().greekWorkspace;

async function fetchOptionHistory(
  instruments: Instrument[],
  from: string,
  to: string,
  resolution: string,
): Promise<HistoricalCandle[][]> {
  const results: HistoricalCandle[][] = Array.from({ length: instruments.length }, () => []);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < instruments.length) {
      const index = nextIndex++;
      try { results[index] = await getHistoricalCandles(instruments[index].trading_symbol, from, to, resolution); }
      catch { results[index] = []; }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(HISTORY_FETCH_CONCURRENCY, instruments.length) }, () => worker())
  );
  return results;
}

function dates() {
  return recentMarketDateRange();
}

function tickTimeMs(timestamp: number | undefined): number | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function replayUnderlyingCandles(
  timeline: Array<Record<string, MarketTick>>,
  symbol: string,
): HistoricalCandle[] {
  return timeline.flatMap((step) => {
    const tick = step[symbol];
    const timestamp = tickTimeMs(tick?.timestamp);
    if (!tick || timestamp === null || !Number.isFinite(tick.last_price)) return [];
    const price = tick.last_price;
    return [{
      timestamp: new Date(timestamp).toISOString(),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: tick.volume ?? 0,
      open_interest: tick.open_interest ?? 0,
    }];
  });
}

interface AlertModalState {
  open: boolean;
  metric?: GreekMetric;
}

function GreekAnalysisWorkspace() {
  const [selected, setSelected] = useState<Instrument[]>([]);
  const [expiryInstruments, setExpiryInstruments] = useState<Instrument[]>([]);
  const [selectionPaths, setSelectionPaths] = useState<ResolvedSelectionPaths>({});
  const [candles, setCandles] = useState<Record<string, HistoricalCandle[]>>({});
  const [underlyingCandles, setUnderlyingCandles] = useState<HistoricalCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [visibleGreeks, setVisibleGreeks] = useState<GreekMetric[]>(() => [...DEFAULT_GREEK_WORKSPACE_PREFERENCES.visibleGreeks]);
  // Keep the chart workspace compact on first open. A saved layout can still
  // restore the user's explicit education-panel preference.
  const [educationOpen, setEducationOpen] = useState(DEFAULT_GREEK_WORKSPACE_PREFERENCES.educationOpen);
  const [panelLayouts, setPanelLayouts] = useState<Partial<Record<GreekMetric, GreekPanelLayout>>>({ ...DEFAULT_GREEK_WORKSPACE_PREFERENCES.panels });
  const [layoutMessage, setLayoutMessage] = useState("");
  const [activeTab, setActiveTab] = useState("core");
  const [alertModal, setAlertModal] = useState<AlertModalState>({ open: false });
  const [timeframe, setTimeframe] = useState(DEFAULT_GREEK_WORKSPACE_PREFERENCES.timeframe);
  const [syncCharts, setSyncCharts] = useState(DEFAULT_GREEK_WORKSPACE_PREFERENCES.syncCharts);
  const [rollingSelectionMode, setRollingSelectionMode] = useState<"smooth" | "raw">("smooth");
  const [riskFreeRate, setRiskFreeRate] = useState(0.1);
  const [settingsReady, setSettingsReady] = useState(false);
  const persistedGreekWorkspace = useSettingsStore((state) => state.greekWorkspace);
  const persistedRollingSelectionMode = useSettingsStore((state) => state.optionChain.rollingSelectionMode);
  const persistedRiskFreeRates = useSettingsStore((state) => state.analytics.riskFreeRatePercent);
  const updatePreferences = useSettingsStore((state) => state.updatePreferences);
  const replayIsActive = useReplayStore((state) => state.isActive);
  const replaySymbol = useReplayStore((state) => state.symbol);
  const replaySessionDate = useReplayStore((state) => state.sessionDate);
  const replayInstruments = useReplayStore((state) => state.replayInstruments);
  const replayTimeline = useReplayStore((state) => state.replayTimeline);
  const replayStep = useReplayStore((state) => state.currentStep);

  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") ?? "";
  const expiry = searchParams.get("expiry") ?? "";
  const contractsQuery = searchParams.get("contracts") ?? "";
  const fixedSelections = useMemo(() => parseFixedSelections(contractsQuery), [contractsQuery]);
  const dynamicSelections = useMemo(() => parseDynamicSelections(searchParams.get("dynamic")), [searchParams]);
  const selections = useMemo<AnalysisSelection[]>(() => [...fixedSelections, ...dynamicSelections].slice(0, MAX_ANALYSIS_SELECTIONS), [fixedSelections, dynamicSelections]);
  const persistedRiskFreeRatePercent = persistedRiskFreeRates[symbol.trim().toUpperCase()]
    ?? persistedRiskFreeRates[DEFAULT_RATE_SYMBOL]
    ?? 10;

  // Zustand's persist middleware may expose browser-only values before the
  // hydration pass. Do not put those values in the initial JSX; synchronize
  // them after mount so SSR and the first browser render stay identical.
  useEffect(() => {
    setVisibleGreeks([...persistedGreekWorkspace.visibleGreeks]);
    setEducationOpen(persistedGreekWorkspace.educationOpen);
    setPanelLayouts({ ...persistedGreekWorkspace.panels });
    setTimeframe(persistedGreekWorkspace.timeframe);
    setSyncCharts(persistedGreekWorkspace.syncCharts);
    setRollingSelectionMode(persistedRollingSelectionMode);
    setRiskFreeRate(persistedRiskFreeRatePercent / 100);
    setSettingsReady(true);
  }, [persistedGreekWorkspace, persistedRiskFreeRatePercent, persistedRollingSelectionMode]);

  const load = useCallback(async () => {
    if (!settingsReady) return;
    if (!symbol || selections.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = dates();
      const sourceInstruments = replayIsActive && replaySymbol === symbol && replayInstruments.length > 0
        ? replayInstruments
        : (await getInstruments(symbol)).instruments;
      const expiryContracts = sourceInstruments.filter((item) => !expiry || item.expiry === expiry);
      const fixedBySymbol = Object.fromEntries(expiryContracts.map((item) => [item.trading_symbol, item]));
      if (replayIsActive && replaySymbol === symbol && replayTimeline.length > 0) {
        // Replay already contains the underlying timeline and every contract
        // in the selected expiry. Do not issue a second broker history burst;
        // the same ticks now become the Greek workspace's source candles.
        const replayUnderlying = replayUnderlyingCandles(replayTimeline, symbol);
        const paths = buildResolvedSelectionPaths(selections, fixedBySymbol, expiryContracts, replayUnderlying, rollingSelectionMode);
        const fixed = fixedSelections.flatMap((selection) => fixedBySymbol[selection.tradingSymbol] ? [fixedBySymbol[selection.tradingSymbol]] : []);
        setSelected(fixed);
        setExpiryInstruments(expiryContracts);
        setSelectionPaths(paths);
        setUnderlyingCandles(replayUnderlying);
        setCandles({});
        return;
      }
      // Dynamic descriptors cannot be determined until we have the spot
      // candle. Resolve their per-candle source set before requesting any
      // option history, then keep broker calls at two concurrent requests.
      const underlying = await getHistoricalCandles(symbol, from, to, timeframe);
      const paths = buildResolvedSelectionPaths(selections, fixedBySymbol, expiryContracts, underlying, rollingSelectionMode);
      const required = instrumentsRequiredByPaths(paths, selections, fixedBySymbol, expiryContracts, underlying, rollingSelectionMode);
      if (required.length > MAX_DYNAMIC_HISTORY_CONTRACTS) {
        throw new Error(`Rolling selection needs ${required.length} source contracts; the maximum is ${MAX_DYNAMIC_HISTORY_CONTRACTS}. Reduce selections or switch to Raw rolling mode.`);
      }
      const optionCandleResults = await fetchOptionHistory(required, from, to, timeframe);
      const fixed = fixedSelections.flatMap((selection) => fixedBySymbol[selection.tradingSymbol] ? [fixedBySymbol[selection.tradingSymbol]] : []);
      setSelected(fixed);
      setExpiryInstruments(expiryContracts);
      setSelectionPaths(paths);
      setUnderlyingCandles(underlying);
      setCandles(Object.fromEntries(required.map((item, index) => [item.trading_symbol, optionCandleResults[index] ?? []])));
    } catch (loadError) {
      setError(loadError);
      setSelected([]);
      setExpiryInstruments([]);
      setSelectionPaths({});
      setCandles({});
      setUnderlyingCandles([]);
    } finally {
      setLoading(false);
    }
  }, [expiry, fixedSelections, replayInstruments, replayIsActive, replaySymbol, replayTimeline, rollingSelectionMode, selections, settingsReady, symbol, timeframe]);

  useEffect(() => { void load(); }, [load]);

  // Keep the underlying subscription separate so a dynamic descriptor can
  // immediately switch its option-symbol subscription when spot crosses a
  // strike boundary.
  const { ticks: underlyingTicks } = useMarketData(symbol ? [symbol] : []);
  const spot = underlyingTicks[symbol]?.last_price ?? underlyingCandles[underlyingCandles.length - 1]?.close ?? defaultSpotFallback(symbol);
  const fixedBySymbol = useMemo(() => Object.fromEntries(selected.map((item) => [item.trading_symbol, item])), [selected]);
  const currentResolved = useMemo(() => currentResolvedSelections(selections, fixedBySymbol, expiryInstruments, spot, rollingSelectionMode), [selections, fixedBySymbol, expiryInstruments, spot, rollingSelectionMode]);
  const liveSymbols = useMemo(() => Array.from(new Set(Object.values(currentResolved).flatMap((resolution) => resolution?.components.map(({ instrument }) => instrument.trading_symbol) ?? []))), [currentResolved]);
  const { ticks: optionTicks } = useMarketData(liveSymbols);
  const ticks = useMemo(() => ({ ...underlyingTicks, ...optionTicks }), [underlyingTicks, optionTicks]);
  const historicalGreekSeries = useMemo(() => buildResolvedGreekSeries(selectionPaths, candles, underlyingCandles, riskFreeRate, selections, fixedBySymbol, expiryInstruments, rollingSelectionMode), [selectionPaths, candles, underlyingCandles, riskFreeRate, selections, fixedBySymbol, expiryInstruments, rollingSelectionMode]);
  const historicalCombinedSeries = useMemo(() => combineGreekSeries(historicalGreekSeries), [historicalGreekSeries]);
  const resolvedLiveSelections = useMemo(() => selections.map((selection) => currentResolved[selection.id] ?? null), [selections, currentResolved]);
  const liveGreeks = useMemo(() => calculateLiveResolvedGreeks(resolvedLiveSelections, symbol, ticks, riskFreeRate), [resolvedLiveSelections, symbol, ticks, riskFreeRate]);
  const replayCombinedSeries = useMemo(() => {
    if (!replayIsActive || replaySymbol !== symbol || replayTimeline.length === 0) return null;
    return combineGreekSeries(buildReplayResolvedGreekSeries(
      selections,
      fixedBySymbol,
      expiryInstruments,
      replayTimeline,
      replayStep,
      symbol,
      riskFreeRate,
      rollingSelectionMode,
    ));
  }, [expiryInstruments, fixedBySymbol, replayIsActive, replayStep, replaySymbol, replayTimeline, riskFreeRate, rollingSelectionMode, selections, symbol]);
  const greekSeries = useMemo(() => appendLiveGreekValues(replayCombinedSeries ?? historicalCombinedSeries, liveGreeks), [historicalCombinedSeries, liveGreeks, replayCombinedSeries]);

  // Spot / DTE / ATM IV / ATM theoretical price — a one-shot summary
  // computed from data already fetched above, purely for the summary strip.
  // Does not touch the combined Greek series math.
  const summary = useMemo(() => {
    const spot = ticks[symbol]?.last_price
      ?? underlyingCandles[underlyingCandles.length - 1]?.close
      ?? defaultSpotFallback(symbol);
    const valuationTime = tickTimeMs(ticks[symbol]?.timestamp) ?? Date.now();
    const dte = daysToExpiry(expiry, valuationTime);

    const strikes = selected.map((instrument) => instrument.strike).filter((strike): strike is number => strike != null);
    let atmIv: number | null = null;
    let atmPrice: number | null = null;
    if (strikes.length > 0) {
      const atmStrike = nearestStrikeTo(strikes, spot);
      const atmInstrument = selected.find((instrument) => instrument.strike === atmStrike && instrument.option_type === "CE")
        ?? selected.find((instrument) => instrument.strike === atmStrike);
      if (atmInstrument?.option_type) {
        const latestPrice = ticks[atmInstrument.trading_symbol]?.last_price
          ?? candles[atmInstrument.trading_symbol]?.[candles[atmInstrument.trading_symbol].length - 1]?.close;
        const T = timeToExpiry(expiry, valuationTime);
        if (latestPrice) {
          const iv = calculateImpliedVolatility(atmInstrument.option_type, spot, atmStrike, T, riskFreeRate, latestPrice);
          if (iv > 0) {
            atmIv = iv;
            atmPrice = calculateGreeks(atmInstrument.option_type, spot, atmStrike, T, riskFreeRate, iv).price;
          }
        }
      }
    }
    return { spot, dte, atmIv, atmPrice };
  }, [ticks, symbol, underlyingCandles, expiry, selected, candles, riskFreeRate]);

  const toggleGreek = (metric: GreekMetric) => setVisibleGreeks((current) => current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]);
  const panelLayoutFor = useCallback((metric: GreekMetric) => panelLayouts[metric] ?? DEFAULT_GREEK_PANEL_LAYOUT, [panelLayouts]);
  const updatePanelLayout = useCallback((metric: GreekMetric, layout: GreekPanelLayout) => {
    setPanelLayouts((current) => ({ ...current, [metric]: layout }));
  }, []);
  const saveLayout = () => {
    saveGreekWorkspaceLayout({ version: 1, visibleGreeks, panels: panelLayouts, educationOpen });
    useSettingsStore.getState().updatePreferences((current) => ({
      ...current,
      greekWorkspace: { ...current.greekWorkspace, timeframe, visibleGreeks, panels: panelLayouts, educationOpen, syncCharts },
    }));
    setLayoutMessage("Layout saved to your profile. It will load for your next strike selection.");
  };

  const liveContracts = liveGreeks?.liveContracts ?? 0;
  const totalContracts = selections.length;
  const requestAlert = (metric: GreekMetric) => setAlertModal({ open: true, metric });

  return (
    <DashboardLayout>
      <GreekChartSyncProvider enabled={syncCharts}>
      {/* This page intentionally skips PageContainer's max-w-6xl — the
          chart-dense workspace needs the full window; DashboardLayout is
          still used so the user never loses main nav. */}
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <WorkspaceHeader
          symbol={symbol}
          expiry={expiry}
          selectedCount={selections.length}
          loading={loading}
          educationOpen={educationOpen}
          layoutMessage={layoutMessage}
          onShowEducation={() => setEducationOpen(true)}
          onSave={saveLayout}
          onRefresh={() => void load()}
          onCreateAlert={() => setAlertModal({ open: true })}
          onOpenMarketStructure={() => window.open(`/market-structure?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`, "_blank", "noopener,noreferrer")}
          alertsDisabled={dynamicSelections.length > 0}
          alertDisabledReason={dynamicSelections.length > 0 ? "Rolling ATM/OTM/ITM selections cannot be saved as durable broker-contract alerts." : undefined}
          timeframe={timeframe}
          onTimeframeChange={(nextTimeframe) => setTimeframe(nextTimeframe as typeof timeframe)}
          syncCharts={syncCharts}
          onToggleSyncCharts={() => setSyncCharts((current) => !current)}
          rollingSelectionMode={rollingSelectionMode}
          rollingToggleDisabled={dynamicSelections.length === 0}
          onToggleRollingMode={() => updatePreferences((current) => ({ ...current, optionChain: { ...current.optionChain, rollingSelectionMode: current.optionChain.rollingSelectionMode === "smooth" ? "raw" : "smooth" } }))}
          replayActive={replayIsActive && replaySymbol === symbol}
          replaySessionDate={replaySessionDate}
        />

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <GreekEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
            {!symbol || selections.length === 0 ? (
              <section className="panel"><EmptyState title="Select option contracts in the Option Chain before opening this workspace." /></section>
            ) : loading ? (
              <section className="panel"><LoadingState size="lg" label="Recalculating historical option Greeks…" /></section>
            ) : error ? (
              <section className="panel flex flex-col gap-3"><EmptyState title="Could not load Greek analysis" /><ApiErrorDisplay error={error} /></section>
            ) : Object.keys(selectionPaths).length === 0 ? (
              <section className="panel"><EmptyState title="The selected contracts are no longer available for this expiry." /></section>
            ) : (
              <>
                <SelectedStrikesCard instruments={selected} expiry={expiry} rollingSelections={dynamicSelections.map((selection) => ({ label: dynamicSelectionLabel(selection), resolution: currentResolved[selection.id] ?? null }))} />
                <WorkspaceSummaryStrip
                  spot={summary.spot}
                  dte={summary.dte}
                  atmIv={summary.atmIv}
                  atmPrice={summary.atmPrice}
                  liveContracts={liveContracts}
                  totalContracts={totalContracts}
                  quoteQuality={liveGreeks?.quoteQuality}
                />

                <GreekMetricSelector
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  visibleGreeks={visibleGreeks}
                  onToggle={toggleGreek}
                  liveCoverageLabel={liveGreeks ? `${liveGreeks.liveContracts}/${liveGreeks.totalContracts}` : `0/${selections.length}`}
                />

                <GreekPanelSection
                  metrics={activeTab === "core" ? FIRST_ORDER_GREEKS : HIGHER_ORDER_GREEKS}
                  visibleGreeks={visibleGreeks}
                  greekSeries={greekSeries}
                  liveContracts={liveContracts}
                  totalContracts={totalContracts}
                  syncIdPrefix={`selected-${activeTab}`}
                  panelLayoutFor={panelLayoutFor}
                  onLayoutChange={updatePanelLayout}
                  onRequestAlert={dynamicSelections.length ? () => undefined : requestAlert}
                  alertsDisabled={dynamicSelections.length > 0}
                  alertDisabledReason="Rolling ATM/OTM/ITM selections cannot be saved as durable broker-contract alerts."
                />
              </>
            )}
          </div>
        </div>
      </div>
      </GreekChartSyncProvider>

      {dynamicSelections.length === 0 && <CreateGreekAlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ open: false })}
        instruments={selected}
        initialMetric={alertModal.metric}
      />}
    </DashboardLayout>
  );
}

export default function GreekAnalysisPage() {
  return (
    <Suspense fallback={<DashboardLayout><LoadingState size="lg" label="Opening Greek workspace…" /></DashboardLayout>}>
      <GreekAnalysisWorkspace />
    </Suspense>
  );
}
