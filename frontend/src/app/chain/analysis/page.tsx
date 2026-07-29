"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { GreekChartCard } from "@/components/charts/GreekChartCard";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Select } from "@/components/ui/Select";
import { getHistoricalCandles, getInstruments, type HistoricalCandle } from "@/lib/market";
import { buildGreekRatios, buildStrikeGreekSeries, FIRST_ORDER_GREEKS, HIGHER_ORDER_GREEKS, type GreekMetric } from "@/lib/strikeGreekAnalysis";
import type { Instrument } from "@/types/market";

const GREEK_LABEL: Record<GreekMetric, string> = {
  delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega", rho: "Rho",
  vanna: "Vanna", vomma: "Vomma", charm: "Charm", speed: "Speed", color: "Color", zomma: "Zomma", ultima: "Ultima",
};

function dates() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 5);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function GreekAnalysisWorkspace() {
  const [selected, setSelected] = useState<Instrument[]>([]);
  const [candles, setCandles] = useState<Record<string, HistoricalCandle[]>>({});
  const [underlyingCandles, setUnderlyingCandles] = useState<HistoricalCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [visibleGreeks, setVisibleGreeks] = useState<GreekMetric[]>(["delta", "gamma", "theta", "vega", "vanna", "vomma"]);
  const [ratioGreek, setRatioGreek] = useState<GreekMetric>("delta");
  const [baseSymbol, setBaseSymbol] = useState("");

  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") ?? "";
  const expiry = searchParams.get("expiry") ?? "";
  const contracts = useMemo(() => (searchParams.get("contracts") ?? "").split(",").filter(Boolean).slice(0, 10), [searchParams]);

  const load = async () => {
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
      const [underlying, ...optionCandleResults] = await Promise.all([
        getHistoricalCandles(symbol, from, to, "5"),
        ...instruments.map((item) => getHistoricalCandles(item.trading_symbol, from, to, "5")),
      ]);
      setSelected(instruments);
      setUnderlyingCandles(underlying);
      setCandles(Object.fromEntries(instruments.map((item, index) => [item.trading_symbol, optionCandleResults[index] ?? []])));
      setBaseSymbol((current) => instruments.some((item) => item.trading_symbol === current) ? current : (instruments[0]?.trading_symbol ?? ""));
    } catch (loadError) {
      setError(loadError);
      setSelected([]);
      setCandles({});
      setUnderlyingCandles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [symbol, expiry, contracts.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const greekSeries = useMemo(() => buildStrikeGreekSeries(selected, candles, underlyingCandles), [selected, candles, underlyingCandles]);
  const availableForRatio = useMemo(() => Object.keys(greekSeries[ratioGreek]).filter((key) => greekSeries[ratioGreek][key].length > 0), [greekSeries, ratioGreek]);
  const ratios = useMemo(() => buildGreekRatios(greekSeries[ratioGreek], baseSymbol), [greekSeries, ratioGreek, baseSymbol]);
  const toggleGreek = (metric: GreekMetric) => setVisibleGreeks((current) => current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]);

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)] px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-[var(--color-border-default)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/chain" className="mt-1 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]" title="Back to option chain"><ArrowLeft className="h-5 w-5" /></Link>
            <div><h1 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text-bright)]"><BarChart3 className="h-5 w-5 text-[var(--color-accent-blue)]" /> Option Greek workspace</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{symbol || "No instrument"}{expiry ? ` · ${expiry}` : ""} · {selected.length} selected contracts</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh historical values</Button>
        </header>

        {!symbol || contracts.length === 0 ? <section className="panel"><EmptyState title="Select option contracts in the Option Chain before opening this workspace." /></section> : loading ? <section className="panel"><LoadingState size="lg" label="Recalculating historical option Greeks…" /></section> : error ? <section className="panel flex flex-col gap-3"><EmptyState title="Could not load Greek analysis" /><ApiErrorDisplay error={error} /></section> : selected.length === 0 ? <section className="panel"><EmptyState title="The selected contracts are no longer available for this expiry." /></section> : <>
          <section className="panel flex flex-col gap-3 p-4">
            <div><h2 className="font-semibold text-[var(--color-text-bright)]">Dashboard panels</h2><p className="text-xs text-[var(--color-text-muted)]">Choose the Greeks to show. Every visible Greek panel has independent overlays and a threshold alert for its focused contract.</p></div>
            <div className="flex flex-wrap gap-2">
              {[...FIRST_ORDER_GREEKS, ...HIGHER_ORDER_GREEKS].map((metric) => <button type="button" key={metric} onClick={() => toggleGreek(metric)} className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${visibleGreeks.includes(metric) ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/15 text-[var(--color-text-bright)]" : "border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"}`}>{GREEK_LABEL[metric]}</button>)}
            </div>
          </section>

          <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Core Greeks</h2><div className="grid gap-4 2xl:grid-cols-2">{FIRST_ORDER_GREEKS.filter((metric) => visibleGreeks.includes(metric)).map((metric) => <GreekChartCard key={metric} title={GREEK_LABEL[metric]} metric={metric} series={greekSeries[metric]} instruments={selected} />)}</div></section>
          <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Higher-order Greeks</h2><div className="grid gap-4 2xl:grid-cols-2">{HIGHER_ORDER_GREEKS.filter((metric) => visibleGreeks.includes(metric)).map((metric) => <GreekChartCard key={metric} title={GREEK_LABEL[metric]} metric={metric} series={greekSeries[metric]} instruments={selected} />)}</div></section>

          <section className="panel flex flex-col gap-3 p-4"><div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="font-semibold text-[var(--color-text-bright)]">Greek ratio</h2><p className="text-xs text-[var(--color-text-muted)]">Compare each selected contract’s Greek against a base contract at matching timestamps.</p></div><div className="flex flex-wrap gap-2"><Select aria-label="Greek ratio metric" value={ratioGreek} onChange={(event) => setRatioGreek(event.target.value as GreekMetric)} className="h-8 w-32 text-xs">{[...FIRST_ORDER_GREEKS, ...HIGHER_ORDER_GREEKS].map((metric) => <option key={metric} value={metric}>{GREEK_LABEL[metric]}</option>)}</Select><Select aria-label="Greek ratio base contract" value={baseSymbol} onChange={(event) => setBaseSymbol(event.target.value)} className="h-8 max-w-60 text-xs">{availableForRatio.map((item) => <option key={item} value={item}>{item}</option>)}</Select></div></div><GreekChartCard title={`${GREEK_LABEL[ratioGreek]} ratio`} metric={ratioGreek} series={ratios} instruments={selected} ratio /></section>
        </>}
      </div>
    </main>
  );
}

export default function GreekAnalysisPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[var(--color-bg-primary)]"><LoadingState size="lg" label="Opening Greek workspace…" /></main>}><GreekAnalysisWorkspace /></Suspense>;
}
