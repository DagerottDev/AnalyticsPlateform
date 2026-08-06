"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MarketStructurePanel } from "@/components/greek-workspace/MarketStructurePanel";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useMarketData } from "@/hooks/useMarketData";
import { defaultSpotFallback } from "@/lib/optionMath";
import { getInstruments, getMarketQuotes } from "@/lib/market";
import { riskFreeRateForSymbol } from "@/stores/settingsStore";
import type { Instrument, MarketTick } from "@/types/market";

const QUOTE_BATCH_SIZE = 50;
const REFRESH_MS = 30_000;

async function quotesFor(symbols: string[]): Promise<MarketTick[]> {
  const batches = Array.from(
    { length: Math.ceil(symbols.length / QUOTE_BATCH_SIZE) },
    (_, index) => symbols.slice(index * QUOTE_BATCH_SIZE, (index + 1) * QUOTE_BATCH_SIZE),
  );
  const quotes: MarketTick[] = [];
  // Keep the broker history/quote load gentle even for large stock-option chains.
  for (let index = 0; index < batches.length; index += 2) {
    const responses = await Promise.all(
      batches.slice(index, index + 2).map((batch) => getMarketQuotes(batch).then((response) => response.quotes).catch(() => [])),
    );
    quotes.push(...responses.flat());
  }
  return quotes;
}

function MarketStructureWorkspace() {
  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") ?? "";
  const expiry = searchParams.get("expiry") ?? "";
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [snapshotTicks, setSnapshotTicks] = useState<Record<string, MarketTick>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { ticks: liveTicks } = useMarketData(symbol ? [symbol] : []);
  const rate = riskFreeRateForSymbol(symbol);

  const load = useCallback(async () => {
    if (!symbol || !expiry) {
      setLoading(false);
      return;
    }
    setError(null);
    setRefreshing(true);
    try {
      const response = await getInstruments(symbol);
      const expiryInstruments = response.instruments.filter((instrument) => instrument.expiry === expiry);
      const quotes = await quotesFor([...expiryInstruments.map((instrument) => instrument.trading_symbol), symbol]);
      setInstruments(expiryInstruments);
      setSnapshotTicks(Object.fromEntries(quotes.map((quote) => [quote.trading_symbol, quote])));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [expiry, symbol]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const ticks = useMemo(() => ({ ...snapshotTicks, ...liveTicks }), [liveTicks, snapshotTicks]);
  const spot = ticks[symbol]?.last_price ?? defaultSpotFallback(symbol);

  return <DashboardLayout><PageContainer className="max-w-[1800px]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <Link href={`/chain?symbol=${encodeURIComponent(symbol)}`} className="mt-1 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]" title="Back to Option Chain"><ArrowLeft className="h-5 w-5" /></Link>
        <SectionHeader title="Market Structure" description={`${symbol || "No instrument"}${expiry ? ` · ${expiry}` : ""} · full-expiry OI concentration and conditional Greek profiles`} />
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
        <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
      </Button>
    </div>
    {!symbol || !expiry ? <EmptyState title="Open Market Structure from the Option Greek workspace after choosing an expiry." />
      : loading ? <LoadingState size="lg" label="Loading full-expiry market structure…" />
        : error ? <ApiErrorDisplay error={error} />
          : instruments.length === 0 ? <EmptyState title="No option contracts are available for this expiry." />
            : <MarketStructurePanel instruments={instruments} ticks={ticks} spot={spot} rate={rate} />}
  </PageContainer></DashboardLayout>;
}

export default function MarketStructurePage() {
  return <Suspense fallback={<DashboardLayout><LoadingState size="lg" label="Opening market structure…" /></DashboardLayout>}><MarketStructureWorkspace /></Suspense>;
}
