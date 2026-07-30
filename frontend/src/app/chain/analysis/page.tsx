"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, BookOpen, RefreshCw, Save } from "lucide-react";
import { GreekChartCard } from "@/components/charts/GreekChartCard";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { GreekEducationAside } from "@/components/market/GreekEducationAside";
import { CORE_GREEKS_REFERENCE, GREEKS_GLOSSARY_REFERENCE } from "@/lib/greekEducation";
import { DEFAULT_GREEK_PANEL_LAYOUT, loadGreekWorkspaceLayout, saveGreekWorkspaceLayout, type GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import { getHistoricalCandles, getInstruments, type HistoricalCandle } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { appendLiveGreekValues, buildStrikeGreekSeries, calculateLiveCombinedGreeks, combineGreekSeries, FIRST_ORDER_GREEKS, HIGHER_ORDER_GREEKS, type GreekMetric } from "@/lib/strikeGreekAnalysis";
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
  const [educationOpen, setEducationOpen] = useState(true);
  const [panelLayouts, setPanelLayouts] = useState<Partial<Record<GreekMetric, GreekPanelLayout>>>({});
  const [layoutMessage, setLayoutMessage] = useState("");

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
      const [underlying, ...optionCandleResults] = await Promise.all([
        getHistoricalCandles(symbol, from, to, "5"),
        ...instruments.map((item) => getHistoricalCandles(item.trading_symbol, from, to, "5")),
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
  const toggleGreek = (metric: GreekMetric) => setVisibleGreeks((current) => current.includes(metric) ? current.filter((item) => item !== metric) : [...current, metric]);
  const panelLayoutFor = useCallback((metric: GreekMetric) => panelLayouts[metric] ?? DEFAULT_GREEK_PANEL_LAYOUT, [panelLayouts]);
  const updatePanelLayout = useCallback((metric: GreekMetric, layout: GreekPanelLayout) => {
    setPanelLayouts((current) => ({ ...current, [metric]: layout }));
  }, []);
  const saveLayout = () => {
    saveGreekWorkspaceLayout({ version: 1, visibleGreeks, panels: panelLayouts, educationOpen });
    setLayoutMessage("Layout saved. It will load for your next strike selection.");
  };

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)] px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-[var(--color-border-default)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/chain" className="mt-1 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-bright)]" title="Back to option chain"><ArrowLeft className="h-5 w-5" /></Link>
            <div><h1 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text-bright)]"><BarChart3 className="h-5 w-5 text-[var(--color-accent-blue)]" /> Option Greek workspace <EducationPopover title="Option Greek workspace" description="Select option contracts in the Option Chain, then compare their combined Greek exposure over history and with live quotes. The page intentionally uses the full window so charts have more room." tips={["Live aggregation waits until all selected contracts have quotes.", "Use the panel controls below to focus the dashboard on the sensitivities you need."]} links={[{ label: "OIC: Understanding option Greeks", href: CORE_GREEKS_REFERENCE }]} /></h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{symbol || "No instrument"}{expiry ? ` · ${expiry}` : ""} · {selected.length} selected contracts</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={saveLayout}><Save className="h-4 w-4" /> Save layout</Button>
            {!educationOpen && <Button variant="outline" size="sm" onClick={() => setEducationOpen(true)}><BookOpen className="h-4 w-4" /> Show education</Button>}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /> Refresh historical values</Button>
          </div>
        </header>

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <GreekEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
        {!symbol || contracts.length === 0 ? <section className="panel"><EmptyState title="Select option contracts in the Option Chain before opening this workspace." /></section> : loading ? <section className="panel"><LoadingState size="lg" label="Recalculating historical option Greeks…" /></section> : error ? <section className="panel flex flex-col gap-3"><EmptyState title="Could not load Greek analysis" /><ApiErrorDisplay error={error} /></section> : selected.length === 0 ? <section className="panel"><EmptyState title="The selected contracts are no longer available for this expiry." /></section> : <>
          <section className="panel flex flex-col gap-3 p-4">
            <div><div className="flex items-center gap-1"><h2 className="font-semibold text-[var(--color-text-bright)]">Dashboard panels</h2><EducationPopover title="Dashboard panels" description="Toggle a Greek to add or remove its chart. Each visible panel combines one contract from every selected strike into a single aggregate exposure line." tips={["Core Greeks describe primary sensitivities.", "Higher-order Greeks describe how those sensitivities change."]} links={[{ label: "OIC: Greeks and volatility", href: CORE_GREEKS_REFERENCE }, { label: "OIC options glossary", href: GREEKS_GLOSSARY_REFERENCE }]} /></div><p className="text-xs text-[var(--color-text-muted)]">Each panel combines the selected strikes into one Greek line. Live quote coverage: {liveGreeks ? `${liveGreeks.liveContracts}/${liveGreeks.totalContracts}` : `0/${selected.length}`}.</p></div>
            {layoutMessage && <p className="text-xs text-[var(--color-profit)]" role="status">{layoutMessage}</p>}
            <div className="flex flex-wrap gap-2">
              {[...FIRST_ORDER_GREEKS, ...HIGHER_ORDER_GREEKS].map((metric) => <button type="button" key={metric} onClick={() => toggleGreek(metric)} className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${visibleGreeks.includes(metric) ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/15 text-[var(--color-text-bright)]" : "border-[var(--color-border-default)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"}`}>{GREEK_LABEL[metric]}</button>)}
            </div>
          </section>

          <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Core Greeks</h2><div className="grid gap-4 2xl:grid-cols-2">{FIRST_ORDER_GREEKS.filter((metric) => visibleGreeks.includes(metric)).map((metric) => <GreekChartCard key={metric} title={GREEK_LABEL[metric]} metric={metric} points={greekSeries[metric]} instruments={selected} liveContracts={liveGreeks?.liveContracts ?? 0} totalContracts={selected.length} layout={panelLayoutFor(metric)} onLayoutChange={(layout) => updatePanelLayout(metric, layout)} />)}</div></section>
          <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Higher-order Greeks</h2><div className="grid gap-4 2xl:grid-cols-2">{HIGHER_ORDER_GREEKS.filter((metric) => visibleGreeks.includes(metric)).map((metric) => <GreekChartCard key={metric} title={GREEK_LABEL[metric]} metric={metric} points={greekSeries[metric]} instruments={selected} liveContracts={liveGreeks?.liveContracts ?? 0} totalContracts={selected.length} layout={panelLayoutFor(metric)} onLayoutChange={(layout) => updatePanelLayout(metric, layout)} />)}</div></section>
        </>}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function GreekAnalysisPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[var(--color-bg-primary)]"><LoadingState size="lg" label="Opening Greek workspace…" /></main>}><GreekAnalysisWorkspace /></Suspense>;
}
