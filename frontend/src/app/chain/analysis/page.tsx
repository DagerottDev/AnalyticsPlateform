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
import { FEATURED_GREEKS } from "@/components/greek-workspace/greekLabels";
import { DEFAULT_GREEK_PANEL_LAYOUT, loadGreekWorkspaceLayout, saveGreekWorkspaceLayout, type GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import { getHistoricalCandles, getInstruments, type HistoricalCandle } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { DEFAULT_RISK_FREE_RATE, defaultSpotFallback, nearestStrikeTo, timeToExpiry } from "@/lib/optionMath";
import { appendLiveGreekValues, buildStrikeGreekSeries, calculateLiveCombinedGreeks, combineGreekSeries, FIRST_ORDER_GREEKS, HIGHER_ORDER_GREEKS, type GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { Instrument } from "@/types/market";

// The broker's history endpoint is much more tightly rate-limited than the
// websocket stream. Keep the analysis workspace deliberately gentle so
// opening it never competes with the already-open option chain's live feed.
const HISTORY_FETCH_CONCURRENCY = 2;

async function fetchOptionHistory(
  instruments: Instrument[],
  from: string,
  to: string
): Promise<HistoricalCandle[][]> {
  const results: HistoricalCandle[][] = Array.from({ length: instruments.length }, () => []);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < instruments.length) {
      const index = nextIndex++;
      results[index] = await getHistoricalCandles(instruments[index].trading_symbol, from, to, "5");
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(HISTORY_FETCH_CONCURRENCY, instruments.length) }, () => worker())
  );
  return results;
}

function dates() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 5);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

interface AlertModalState {
  open: boolean;
  metric?: GreekMetric;
}

function GreekAnalysisWorkspace() {
  const [selected, setSelected] = useState<Instrument[]>([]);
  const [candles, setCandles] = useState<Record<string, HistoricalCandle[]>>({});
  const [underlyingCandles, setUnderlyingCandles] = useState<HistoricalCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [visibleGreeks, setVisibleGreeks] = useState<GreekMetric[]>(["delta", "gamma", "theta", "vega", "vanna", "vomma"]);
  const [educationOpen, setEducationOpen] = useState(true);
  const [panelLayouts, setPanelLayouts] = useState<Partial<Record<GreekMetric, GreekPanelLayout>>>({});
  const [layoutMessage, setLayoutMessage] = useState("");
  const [activeTab, setActiveTab] = useState("core");
  const [alertModal, setAlertModal] = useState<AlertModalState>({ open: false });

  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") ?? "";
  const expiry = searchParams.get("expiry") ?? "";
  const contractsQuery = searchParams.get("contracts") ?? "";
  const contracts = useMemo(() => contractsQuery.split(",").filter(Boolean).slice(0, 10), [contractsQuery]);

  // Apply the reusable presentation preset after client hydration. Contract
  // selection and alerts deliberately remain URL-/session-specific.
  useEffect(() => {
    const savedLayout = loadGreekWorkspaceLayout();
    if (!savedLayout) return;
    setVisibleGreeks(savedLayout.visibleGreeks);
    setPanelLayouts(savedLayout.panels);
    setEducationOpen(savedLayout.educationOpen);
  }, []);

  const load = useCallback(async () => {
    if (!symbol || contracts.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = dates();
      const response = await getInstruments(symbol);
      const instruments = response.instruments.filter((item) => contracts.includes(item.trading_symbol) && (!expiry || item.expiry === expiry));
      // Start the underlying lookup with the small option-history worker
      // pool. This replaces the former 11-way Promise.all burst for a
      // 10-contract selection, which could exhaust FYERS' shared data quota
      // and make the source option-chain window look frozen.
      const [underlying, optionCandleResults] = await Promise.all([
        getHistoricalCandles(symbol, from, to, "5"),
        fetchOptionHistory(instruments, from, to),
      ]);
      setSelected(instruments);
      setUnderlyingCandles(underlying);
      setCandles(Object.fromEntries(instruments.map((item, index) => [item.trading_symbol, optionCandleResults[index] ?? []])));
    } catch (loadError) {
      setError(loadError);
      setSelected([]);
      setCandles({});
      setUnderlyingCandles([]);
    } finally {
      setLoading(false);
    }
  }, [contracts, expiry, symbol]);

  useEffect(() => { void load(); }, [load]);

  const liveSymbols = useMemo(() => [...selected.map((instrument) => instrument.trading_symbol), symbol], [selected, symbol]);
  const { ticks } = useMarketData(liveSymbols);
  const historicalGreekSeries = useMemo(() => buildStrikeGreekSeries(selected, candles, underlyingCandles), [selected, candles, underlyingCandles]);
  const historicalCombinedSeries = useMemo(() => combineGreekSeries(historicalGreekSeries), [historicalGreekSeries]);
  const liveGreeks = useMemo(() => calculateLiveCombinedGreeks(selected, symbol, ticks), [selected, symbol, ticks]);
  const greekSeries = useMemo(() => appendLiveGreekValues(historicalCombinedSeries, liveGreeks), [historicalCombinedSeries, liveGreeks]);

  // Spot / DTE / ATM IV / ATM theoretical price — a one-shot summary
  // computed from data already fetched above, purely for the summary strip.
  // Does not touch the combined Greek series math.
  const summary = useMemo(() => {
    const spot = ticks[symbol]?.last_price
      ?? underlyingCandles[underlyingCandles.length - 1]?.close
      ?? defaultSpotFallback(symbol);
    const dte = Math.round(timeToExpiry(expiry) * 365);

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
        const T = timeToExpiry(expiry);
        if (latestPrice) {
          const iv = calculateImpliedVolatility(atmInstrument.option_type, spot, atmStrike, T, DEFAULT_RISK_FREE_RATE, latestPrice);
          if (iv > 0) {
            atmIv = iv;
            atmPrice = calculateGreeks(atmInstrument.option_type, spot, atmStrike, T, DEFAULT_RISK_FREE_RATE, iv).price;
          }
        }
      }
    }
    return { spot, dte, atmIv, atmPrice };
  }, [ticks, symbol, underlyingCandles, expiry, selected, candles]);

  const toggleGreek = (metric: GreekMetric) => setVisibleGreeks((current) => current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]);
  const panelLayoutFor = useCallback((metric: GreekMetric) => panelLayouts[metric] ?? DEFAULT_GREEK_PANEL_LAYOUT, [panelLayouts]);
  const updatePanelLayout = useCallback((metric: GreekMetric, layout: GreekPanelLayout) => {
    setPanelLayouts((current) => ({ ...current, [metric]: layout }));
  }, []);
  const saveLayout = () => {
    saveGreekWorkspaceLayout({ version: 1, visibleGreeks, panels: panelLayouts, educationOpen });
    setLayoutMessage("Layout saved. It will load for your next strike selection.");
  };

  const liveContracts = liveGreeks?.liveContracts ?? 0;
  const totalContracts = selected.length;
  const requestAlert = (metric: GreekMetric) => setAlertModal({ open: true, metric });

  return (
    <DashboardLayout>
      {/* This page intentionally skips PageContainer's max-w-6xl — the
          chart-dense workspace needs the full window; DashboardLayout is
          still used so the user never loses main nav. */}
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <WorkspaceHeader
          symbol={symbol}
          expiry={expiry}
          selectedCount={selected.length}
          loading={loading}
          educationOpen={educationOpen}
          layoutMessage={layoutMessage}
          onShowEducation={() => setEducationOpen(true)}
          onSave={saveLayout}
          onRefresh={() => void load()}
          onCreateAlert={() => setAlertModal({ open: true })}
        />

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <GreekEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
            {!symbol || contracts.length === 0 ? (
              <section className="panel"><EmptyState title="Select option contracts in the Option Chain before opening this workspace." /></section>
            ) : loading ? (
              <section className="panel"><LoadingState size="lg" label="Recalculating historical option Greeks…" /></section>
            ) : error ? (
              <section className="panel flex flex-col gap-3"><EmptyState title="Could not load Greek analysis" /><ApiErrorDisplay error={error} /></section>
            ) : selected.length === 0 ? (
              <section className="panel"><EmptyState title="The selected contracts are no longer available for this expiry." /></section>
            ) : (
              <>
                <WorkspaceSummaryStrip
                  spot={summary.spot}
                  dte={summary.dte}
                  atmIv={summary.atmIv}
                  atmPrice={summary.atmPrice}
                  liveContracts={liveContracts}
                  totalContracts={totalContracts}
                />

                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Featured</h2>
                  <GreekPanelSection
                    metrics={FEATURED_GREEKS}
                    visibleGreeks={FEATURED_GREEKS}
                    greekSeries={greekSeries}
                    liveContracts={liveContracts}
                    totalContracts={totalContracts}
                    panelLayoutFor={panelLayoutFor}
                    onLayoutChange={updatePanelLayout}
                    onRequestAlert={requestAlert}
                  />
                </div>

                <GreekMetricSelector
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  visibleGreeks={visibleGreeks}
                  onToggle={toggleGreek}
                  liveCoverageLabel={liveGreeks ? `${liveGreeks.liveContracts}/${liveGreeks.totalContracts}` : `0/${selected.length}`}
                />

                <GreekPanelSection
                  metrics={activeTab === "core" ? FIRST_ORDER_GREEKS : HIGHER_ORDER_GREEKS}
                  visibleGreeks={visibleGreeks}
                  greekSeries={greekSeries}
                  liveContracts={liveContracts}
                  totalContracts={totalContracts}
                  panelLayoutFor={panelLayoutFor}
                  onLayoutChange={updatePanelLayout}
                  onRequestAlert={requestAlert}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <CreateGreekAlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ open: false })}
        instruments={selected}
        initialMetric={alertModal.metric}
      />
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
