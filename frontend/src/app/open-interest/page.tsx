"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, RefreshCw, ShieldAlert, Target, TrendingDown, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { DataFreshness } from "@/components/market/DataFreshness";
import { OpenInterestChangeChart } from "@/components/open-interest/OpenInterestChangeChart";
import { OpenInterestProfileChart } from "@/components/open-interest/OpenInterestProfileChart";
import { OpenInterestTimeSeriesChart } from "@/components/open-interest/OpenInterestTimeSeriesChart";
import { OpenInterestTotalsChart } from "@/components/open-interest/OpenInterestTotalsChart";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatTile } from "@/components/ui/StatTile";
import { useMarketData } from "@/hooks/useMarketData";
import { analyzeOpenInterest, type OpenInterestLevel } from "@/lib/openInterestAnalysis";
import { defaultSpotFallback } from "@/lib/optionMath";
import { getInstruments, getMarketQuotes, getOpenInterestHistory, type OpenInterestHistoryResponse, type OpenInterestSnapshot } from "@/lib/market";
import { mergeOpenInterestSnapshots } from "@/lib/openInterestHistory";
import { isNseRegularMarketOpen } from "@/lib/marketSession";
import { useSettingsStore } from "@/stores/settingsStore";
import { quoteLastPrice } from "@/lib/marketTick";
import type { Instrument } from "@/types/market";

function formatLevel(level: OpenInterestLevel | null): string {
  return level ? level.strike.toLocaleString("en-IN") : "—";
}

function formatChange(level: OpenInterestLevel | null): string {
  if (!level) return "No positive addition";
  return `+${level.sessionChange.toLocaleString("en-IN")} OI`;
}

function OpenInterestWorkspace() {
  const searchParams = useSearchParams();
  const refreshMilliseconds = useSettingsStore((state) => state.charts.refreshSeconds * 1000);
  const [symbol, setSymbol] = useState(() => searchParams.get("symbol") ?? useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(() => searchParams.get("expiry"));
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [oiHistory, setOiHistory] = useState<OpenInterestHistoryResponse | null>(null);
  const [snapshotSpot, setSnapshotSpot] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!symbol || !expiry) {
      setInstruments([]);
      setOiHistory(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await getInstruments(symbol);
      const filtered = response.instruments.filter((instrument) => instrument.expiry === expiry);
      const refreshedAt = new Date();
      setInstruments(filtered);
      setLastUpdated(refreshedAt);
      const totals = analyzeOpenInterest(filtered, 0);
      // The history collector tracks the nearest expiry in the background,
      // while the UI also allows older/farther expiries. Keep the selected
      // expiry chart useful in that case by retaining its current broker
      // snapshot as a seed point (and by using it after hours when the
      // websocket/collector is intentionally paused).
      const currentSnapshot: OpenInterestSnapshot | null = (
        totals.totalCallOi > 0 || totals.totalPutOi > 0
      ) ? {
        timestamp: refreshedAt.toISOString(),
        total_call_oi: totals.totalCallOi,
        total_put_oi: totals.totalPutOi,
        total_call_change: totals.totalCallChange,
        total_put_change: totals.totalPutChange,
      } : null;
      try {
        const history = await getOpenInterestHistory(symbol, expiry);
        const shouldSeed = isNseRegularMarketOpen(refreshedAt) || history.points.length === 0;
        setOiHistory({
          ...history,
          points: mergeOpenInterestSnapshots(history.points, shouldSeed ? currentSnapshot : null),
        });
      } catch {
        // The existing profile remains useful if persisted-history retrieval
        // is temporarily unavailable; render the current chain snapshot so
        // the live OI chart is not blank while the next refresh retries it.
        setOiHistory({
          symbol: symbol.toUpperCase(),
          expiry,
          session_date: null,
          points: currentSnapshot ? [currentSnapshot] : [],
          baseline: "broker prior-close OI",
          scheduled_tracking: false,
        });
      }
    } catch (loadError) {
      setError(loadError);
      setInstruments([]);
    } finally {
      setLoading(false);
    }
  }, [expiry, symbol]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), refreshMilliseconds);
    return () => window.clearInterval(intervalId);
  }, [load, refreshMilliseconds]);

  // The live websocket is paused outside the exchange session. Fetch the
  // broker's latest traded quote as a fallback so the spot card remains
  // broker-accurate after hours instead of using the hardcoded placeholder.
  useEffect(() => {
    let isMounted = true;
    setSnapshotSpot(null);

    async function fetchSnapshotSpot() {
      try {
        const { quotes } = await getMarketQuotes([symbol]);
        const quote = quotes.find((item) => item.trading_symbol === symbol) ?? quotes[0];
        const candidate = quoteLastPrice(quote);
        if (isMounted && candidate !== null) setSnapshotSpot(candidate);
      } catch {
        // Keep the existing symbol fallback if the optional quote snapshot is
        // unavailable; option-chain loading remains independent.
      }
    }

    if (symbol) void fetchSnapshotSpot();
    return () => {
      isMounted = false;
    };
  }, [symbol]);

  const marketSymbols = useMemo(() => [symbol], [symbol]);
  const { getTick } = useMarketData(marketSymbols);
  const underlyingTick = getTick(symbol);
  const liveSpot = underlyingTick?.last_price && underlyingTick.last_price > 0
    ? underlyingTick.last_price
    : snapshotSpot;
  // Keep calculations numerically stable while a quote is loading, but never
  // present the synthetic fallback as if it were the market price.
  const spot = liveSpot ?? defaultSpotFallback(symbol);
  const analysis = useMemo(() => analyzeOpenInterest(instruments, spot), [instruments, spot]);

  const handleSymbolChange = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setExpiry(null);
    setInstruments([]);
    setOiHistory(null);
  };

  return (
    <DashboardLayout>
      <PageContainer className="max-w-[1800px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader
            title="Open Interest"
            description="Strike-level OI concentration, market-session positioning, and reference levels from the live option chain."
          />
          <DataFreshness tick={underlyingTick} />
        </div>

        <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:justify-between">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={handleSymbolChange}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="text-xs text-[var(--color-text-muted)]">Updated {lastUpdated.toLocaleTimeString()}</span>}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
            </Button>
          </div>
        </Card>

        {!expiry ? (
          <Card><EmptyState title="Choose an expiry to analyze open interest." /></Card>
        ) : loading && instruments.length === 0 ? (
          <Card><LoadingState size="lg" label="Loading open-interest profile…" /></Card>
        ) : error ? (
          <Card className="flex flex-col gap-3">
            <EmptyState title="Could not load open-interest data." />
            <ApiErrorDisplay error={error} />
          </Card>
        ) : analysis.strikes.length === 0 ? (
          <Card><EmptyState title="No option contracts were returned for this expiry." /></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatTile label="Underlying spot" value={liveSpot === null ? "—" : liveSpot.toLocaleString("en-IN", { maximumFractionDigits: 2 })} icon={Target} />
              <StatTile label="Put OI support" value={formatLevel(analysis.support)} tone="profit" icon={TrendingUp} />
              <StatTile label="Call OI resistance" value={formatLevel(analysis.resistance)} tone="loss" icon={TrendingDown} />
              <StatTile label="Put / call ratio" value={analysis.putCallRatio?.toFixed(2) ?? "—"} icon={BarChart3} />
              <StatTile label="Max pain reference" value={analysis.maxPain?.toLocaleString("en-IN") ?? "—"} icon={ShieldAlert} />
            </div>

            <Card className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Insight label="Support concentration" level={analysis.support} detail="Largest put OI at or below spot" tone="profit" />
              <Insight label="Resistance concentration" level={analysis.resistance} detail="Largest call OI at or above spot" tone="loss" />
              <Insight label="Strongest put addition" level={analysis.strongestPutAddition} detail="Largest positive session put OI change" tone="profit" />
              <Insight label="Strongest call addition" level={analysis.strongestCallAddition} detail="Largest positive session call OI change" tone="loss" />
            </Card>

            <OpenInterestTimeSeriesChart
              points={oiHistory?.points ?? []}
              scheduledTracking={oiHistory?.scheduled_tracking ?? false}
            />

            <OpenInterestTotalsChart
              totalCallOi={analysis.totalCallOi}
              totalPutOi={analysis.totalPutOi}
              totalCallChange={analysis.totalCallChange}
              totalPutChange={analysis.totalPutChange}
            />

            <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
              <OpenInterestProfileChart
                data={analysis.strikes}
                spot={spot}
                support={analysis.support}
                resistance={analysis.resistance}
              />
              <OpenInterestChangeChart data={analysis.strikes} />
            </div>

            <Card className="flex flex-col gap-2 border-[var(--color-accent-orange)]/30 bg-[var(--color-accent-orange)]/5">
              <h2 className="text-sm font-bold text-[var(--color-text-bright)]">How to read these levels</h2>
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                Support and resistance are the largest put and call open-interest concentrations on the relevant side of spot. They are positioning references, not guaranteed price barriers. Session change uses the broker&apos;s prior-close OI baseline; the broker does not provide a separate historical market-open OI snapshot.
              </p>
            </Card>
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}

function Insight({ label, level, detail, tone }: { label: string; level: OpenInterestLevel | null; detail: string; tone: "profit" | "loss" }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={tone === "profit" ? "tnum mt-2 text-xl font-black text-[var(--color-profit)]" : "tnum mt-2 text-xl font-black text-[var(--color-loss)]"}>
        {formatLevel(level)}
      </p>
      <p className="tnum mt-1 text-xs text-[var(--color-text-secondary)]">{level ? `${level.openInterest.toLocaleString("en-IN")} OI · ${formatChange(level)}` : "Unavailable"}</p>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}

export default function OpenInterestPage() {
  return (
    <Suspense fallback={<DashboardLayout><LoadingState size="lg" label="Opening open-interest workspace…" /></DashboardLayout>}>
      <OpenInterestWorkspace />
    </Suspense>
  );
}
