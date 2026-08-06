"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { Instrument, MarketTick } from "@/types/market";
import { getInstruments, getMarketQuotes } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { useNseMarketSession } from "@/hooks/useNseMarketSession";
import { useReplayStore } from "@/stores/replayStore";
import { formatApiError } from "@/lib/apiError";
import { cn, formatINR } from "@/lib/utils";
import { BarChart3, Check, Download, Plus, ShoppingCart, Settings2, TrendingDown, TrendingUp, X } from "lucide-react";
import { BuyTicketModal } from "@/components/market/BuyTicketModal";
import { BasketOrderModal } from "@/components/market/BasketOrderModal";
import { BasketLegDraft, BasketRiskDraft, orderBasketLegsForMargin } from "@/lib/basket";
import { calculateImpliedVolatility, calculateGreeks, Greeks } from "@/lib/greeks";
import { classifyBuildup } from "@/lib/buildup";
import { daysToExpiry, timeToExpiry, nearestStrikeTo, defaultSpotFallback } from "@/lib/optionMath";
import {
  filterOptionChainStrikes,
  MoneynessFilter,
  OptionChainStrikeRow,
  toCsvCell,
} from "@/lib/optionChainFilters";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { DataFreshness } from "@/components/market/DataFreshness";
import { describeDataFreshness, isFreshBrokerStreamTick } from "@/lib/dataFreshness";
import { useSettingsStore } from "@/stores/settingsStore";
import { toClosedMarketQuote } from "@/lib/marketTick";
export { toClosedMarketQuote } from "@/lib/marketTick";
import {
  dynamicSelection,
  dynamicSelectionLabel,
  fixedSelection,
  MAX_ANALYSIS_SELECTIONS,
  serializeDynamicSelections,
  type AnalysisSelection,
  type DynamicMoneyness,
} from "@/lib/analysisSelections";

const MAX_ANALYSIS_CONTRACTS = MAX_ANALYSIS_SELECTIONS;
type TicketSide = "Buy" | "Sell";

interface OptionChainProps {
  symbol: string;
  expiry: string | null;
}

export function OptionChain({ symbol, expiry }: OptionChainProps) {
  const optionChainPreferences = useSettingsStore((state) => state.optionChain);
  const refreshMilliseconds = useSettingsStore((state) => state.charts.refreshSeconds * 1000);
  const riskFreeRate = useSettingsStore((state) => (
    (state.analytics.riskFreeRatePercent[symbol] ?? state.analytics.riskFreeRatePercent.DEFAULT ?? 10) / 100
  ));
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGreeks, setShowGreeks] = useState(() => optionChainPreferences.showGreeks);
  const [showBuildup, setShowBuildup] = useState(() => optionChainPreferences.showBuildup);
  const [moneyness, setMoneyness] = useState<MoneynessFilter>(() => optionChainPreferences.moneyness);
  // Start with the nearest ten strikes on each side of ATM. Traders can
  // widen this range explicitly, including to the complete broker universe.
  const [strikesEachSide, setStrikesEachSide] = useState<number | null>(() => (
    // Treat the previous `null` default as the legacy unconfigured state.
    // Users can still select “All strikes” explicitly from the filter.
    optionChainPreferences.strikesEachSide ?? 10
  ));
  const [previousOiBySymbol, setPreviousOiBySymbol] = useState<Map<string, number>>(new Map());
  const [analysisSelections, setAnalysisSelections] = useState<AnalysisSelection[]>([]);
  const [dynamicOptionType, setDynamicOptionType] = useState<"CE" | "PE">("CE");
  const [dynamicMoneyness, setDynamicMoneyness] = useState<DynamicMoneyness>("ATM");
  const [dynamicOffset, setDynamicOffset] = useState(1);
  const [orderTarget, setOrderTarget] = useState<{ instrument: Instrument; side: TicketSide } | null>(null);
  const [basketLegs, setBasketLegs] = useState<BasketLegDraft[]>([]);
  const [basketRisk, setBasketRisk] = useState<BasketRiskDraft>({});
  const [basketOpen, setBasketOpen] = useState(false);
  const latestOiBySymbol = useRef<Map<string, number>>(new Map());
  const [snapshotTicks, setSnapshotTicks] = useState<Record<string, MarketTick>>({});
  const marketSession = useNseMarketSession();
  const replayIsActive = useReplayStore((state) => state.isActive);

  // Fetch instruments when symbol or expiry changes, then keep OI/buildup
  // fresh with a background poll matching the backend's own ~30s cache TTL —
  // instruments were previously fetched once and never refreshed.
  useEffect(() => {
    let isMounted = true;
    if (!symbol || !expiry) return;

    async function fetchContracts(isBackground: boolean) {
      if (!isBackground) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          // Filter by expiry
          const filtered = data.instruments.filter((i) => i.expiry === expiry);
          // Preserve the last API snapshot so OI changes are local, explicit,
          // and visible even when Fyers' own session-change field is absent.
          setPreviousOiBySymbol(latestOiBySymbol.current);
          latestOiBySymbol.current = new Map(
            filtered.flatMap((instrument) =>
              instrument.oi == null ? [] : [[instrument.trading_symbol, instrument.oi] as const]
            )
          );
          setInstruments(filtered);
          if (!isBackground) {
            setAnalysisSelections([]);
            setBasketLegs([]);
            setBasketRisk({});
            // A new symbol/expiry gets a fresh rolling picker. ATM is the
            // useful starting point; the user can then step out to OTM/ITM.
            setDynamicMoneyness("ATM");
            setDynamicOffset(1);
          }
          if (isBackground) setError(null);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(formatApiError(err) || "Failed to load option chain data.");
        if (!isBackground) setInstruments([]);
      } finally {
        if (isMounted && !isBackground) setLoading(false);
      }
    }

    fetchContracts(false);
    const interval = setInterval(() => fetchContracts(true), refreshMilliseconds);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol, expiry, refreshMilliseconds]);

  // Extract trading symbols for WebSocket subscription
  // Subscribe to live market data + underlying index
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const allSymbolsKey = allSymbols.join(",");
  const { getTick: getLiveTick } = useMarketData(allSymbols);

  // Keep a small, chunked REST poll as a safety net. During regular hours the
  // WebSocket remains preferred, but a stalled stream must not freeze the
  // chain at its last tick. Outside hours this is the primary data source and
  // uses the broker's latest traded quote snapshot below.
  useEffect(() => {
    if (!symbol || replayIsActive || !allSymbolsKey) {
      if (replayIsActive) setSnapshotTicks({});
      return;
    }

    let isMounted = true;
    setSnapshotTicks({});
    const snapshotSymbols = allSymbolsKey.split(",").filter(Boolean);
    const snapshotInterval = Math.max(refreshMilliseconds, 15_000);

    async function fetchSnapshotQuotes() {
      const chunks: string[][] = [];
      for (let index = 0; index < snapshotSymbols.length; index += 40) {
        chunks.push(snapshotSymbols.slice(index, index + 40));
      }
      const quotes: MarketTick[] = [];
      // Keep chunks sequential so a large chain does not create a second
      // quote burst precisely when the websocket is paused.
      for (const chunk of chunks) {
        try {
          const response = await getMarketQuotes(chunk);
          quotes.push(...response.quotes.map((quote) => (
            marketSession.state === "open"
              ? { ...quote, feed: "snapshot" as const }
              : { ...toClosedMarketQuote(quote), feed: "snapshot" as const }
          )));
        } catch {
          // Preserve successful chunks if one broker snapshot is unavailable.
        }
      }
      if (!isMounted) return;
      if (quotes.length === 0) return;
      setSnapshotTicks((current) => ({
        ...current,
        ...Object.fromEntries(quotes.map((quote) => [quote.trading_symbol, quote])),
      }));
    }

    void fetchSnapshotQuotes();
    const interval = window.setInterval(() => void fetchSnapshotQuotes(), snapshotInterval);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [allSymbolsKey, marketSession.state, refreshMilliseconds, replayIsActive, symbol]);

  const getTick = useCallback(
    (tradingSymbol: string): MarketTick | null => {
      const snapshot = snapshotTicks[tradingSymbol];
      const live = getLiveTick(tradingSymbol);
      // A fresh websocket frame is broker evidence that the instrument is
      // still trading, even if the local regular-session calendar has already
      // elapsed. Do not replace that frame with a REST close snapshot.
      if (isFreshBrokerStreamTick(live)) return live;
      if (!snapshot) return live ?? null;
      // useMarketData retains its last live tick when a session closes. Once
      // a snapshot exists, prefer it outside hours; during the session use it
      // only when the live tick is missing or no longer fresh.
      if (!replayIsActive && marketSession.state !== "open") return snapshot;
      if (!live || describeDataFreshness(live).state !== "live") return snapshot;
      return live;
    },
    [getLiveTick, marketSession.state, replayIsActive, snapshotTicks]
  );
  
  // Get underlying price
  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || defaultSpotFallback(symbol);

  // Time to expiry (T) in years
  const T = useMemo(() => timeToExpiry(expiry), [expiry]);
  const dte = useMemo(() => daysToExpiry(expiry), [expiry]);

  const r = riskFreeRate;

  // Group by strike price
  const strikes = useMemo<OptionChainStrikeRow[]>(() => {
    const map = new Map<number, { CE?: Instrument; PE?: Instrument }>();
    instruments.forEach((inst) => {
      if (!inst.strike || !inst.option_type) return;
      if (!map.has(inst.strike)) map.set(inst.strike, {});
      const group = map.get(inst.strike)!;
      group[inst.option_type] = inst;
    });

    return Array.from(map.entries())
      .map(([strike, data]) => ({ strike, ...data }))
      .sort((a, b) => a.strike - b.strike);
  }, [instruments]);

  // Find ATM strike (closest to the live/fallback spot price)
  const atmStrike = useMemo(() => {
    if (strikes.length === 0) return 0;
    return nearestStrikeTo(strikes.map((s) => s.strike), S);
  }, [strikes, S]);

  const filteredStrikes = useMemo(
    () => filterOptionChainStrikes(strikes, atmStrike, moneyness, strikesEachSide),
    [strikes, atmStrike, moneyness, strikesEachSide]
  );

  const oiSnapshotChange = (instrument: Instrument | undefined): number | null => {
    if (!instrument || instrument.oi == null) return null;
    const previous = previousOiBySymbol.get(instrument.trading_symbol);
    return previous == null ? null : instrument.oi - previous;
  };

  const toggleAnalysisContract = (instrument: Instrument | undefined) => {
    if (!instrument) return;
    const selection = fixedSelection(instrument.trading_symbol);
    setAnalysisSelections((current) => {
      if (current.some((item) => item.id === selection.id)) {
        return current.filter((item) => item.id !== selection.id);
      }
      return current.length >= MAX_ANALYSIS_CONTRACTS
        ? current
        : [...current, selection];
    });
  };

  const addDynamicAnalysisSelection = () => {
    const selection = dynamicSelection(dynamicOptionType, dynamicMoneyness, dynamicOffset);
    setAnalysisSelections((current) => {
      if (current.some((item) => item.id === selection.id) || current.length >= MAX_ANALYSIS_CONTRACTS) return current;
      return [...current, selection];
    });
  };

  const removeAnalysisSelection = (id: string) => setAnalysisSelections((current) => current.filter((item) => item.id !== id));
  const selectedAnalysisSymbols = analysisSelections.flatMap((selection) => selection.kind === "fixed" ? [selection.tradingSymbol] : []);
  const dynamicAnalysisSelections = analysisSelections.flatMap((selection) => selection.kind === "dynamic" ? [selection] : []);

  const addBasketLeg = (instrument: Instrument | undefined) => {
    if (!instrument) return;
    setBasketLegs(current => {
      const existing = current.find(leg => leg.instrument.trading_symbol === instrument.trading_symbol);
      if (existing) return current.filter(leg => leg.id !== existing.id);
      if (current.length >= MAX_ANALYSIS_CONTRACTS) return current;
      return orderBasketLegsForMargin([...current, {
        id: `basket-${instrument.trading_symbol}`,
        instrument,
        side: "Buy",
        quantity: instrument.lot_size || 1,
      }]);
    });
  };

  const openStrikeAnalysis = () => {
    if (analysisSelections.length === 0) return;
    const params = new URLSearchParams({
      symbol,
      expiry: expiry ?? "",
      contracts: selectedAnalysisSymbols.join(","),
    });
    if (dynamicAnalysisSelections.length) params.set("dynamic", serializeDynamicSelections(dynamicAnalysisSelections));
    const href = `/chain/analysis?${params.toString()}`;
    const analysisWindow = window.open(href, "strike-analysis");
    if (!analysisWindow) window.location.assign(href);
  };

  const openCombinedPremiumAnalysis = () => {
    if (analysisSelections.length === 0) return;
    const params = new URLSearchParams({
      symbol,
      expiry: expiry ?? "",
      contracts: selectedAnalysisSymbols.join(","),
    });
    if (dynamicAnalysisSelections.length) params.set("dynamic", serializeDynamicSelections(dynamicAnalysisSelections));
    const href = `/chain/premium-analysis?${params.toString()}`;
    // Use the browser's reserved `_blank` target so every click opens the
    // combined-premium workspace in a separate tab instead of reusing a
    // previously named popup window.
    const analysisTab = window.open(href, "_blank");
    if (!analysisTab) window.location.assign(href);
  };

  const openOpenInterestAnalysis = () => {
    if (!expiry) return;
    const params = new URLSearchParams({ symbol, expiry });
    const href = `/open-interest?${params.toString()}`;
    const analysisWindow = window.open(href, "open-interest-analysis");
    if (!analysisWindow) window.location.assign(href);
  };

  const downloadCsv = () => {
    const header = [
      "Symbol", "Expiry", "Strike", "Call OI", "Call OI snapshot change", "Call LTP", "Call volume", "Call change %",
      "Put LTP", "Put change %", "Put volume", "Put OI", "Put OI snapshot change",
    ];
    const rows = filteredStrikes.map((row) => {
      const ceTick = row.CE ? getTick(row.CE.trading_symbol) : null;
      const peTick = row.PE ? getTick(row.PE.trading_symbol) : null;
      return [
        symbol, expiry, row.strike, row.CE?.oi, oiSnapshotChange(row.CE), ceTick?.last_price,
        ceTick?.volume, ceTick?.change_percent, peTick?.last_price, peTick?.change_percent,
        peTick?.volume, row.PE?.oi, oiSnapshotChange(row.PE),
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map(toCsvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol}-${expiry ?? "option-chain"}-option-chain.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="panel">
        <LoadingState size="lg" label="Loading option chain..." />
      </div>
    );
  }

  if (strikes.length === 0) {
    return (
      <div className="panel flex flex-col gap-3">
        <EmptyState
          title={error ? "Failed to load option chain" : "No contracts found for selected expiry."}
        />
        {error && <ApiErrorDisplay error={error} />}
      </div>
    );
  }

  return (
    <div className="panel flex flex-col overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            Underlying ({symbol}): <span className="tnum font-bold text-[var(--color-text-bright)]">{formatINR(S)}</span>
          </span>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            DTE: <span className="tnum font-bold text-[var(--color-text-bright)]">{dte} days</span>
          </span>
          <DataFreshness tick={underlyingTick} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Select
            aria-label="Filter option chain by moneyness"
            value={moneyness}
            onChange={(event) => setMoneyness(event.target.value as MoneynessFilter)}
            className="h-8 w-full text-xs sm:w-32"
          >
            <option value="all">All moneyness</option>
            <option value="itm">ITM calls</option>
            <option value="atm">ATM only</option>
            <option value="otm">OTM calls</option>
          </Select>
          <Select
            aria-label="Filter option chain by strike range"
            value={strikesEachSide ?? "all"}
            onChange={(event) => setStrikesEachSide(event.target.value === "all" ? null : Number(event.target.value))}
            className="h-8 w-full text-xs sm:w-36"
          >
            <option value="all">All strikes</option>
            <option value="5">±5 strikes</option>
            <option value="10">±10 strikes</option>
            <option value="20">±20 strikes</option>
          </Select>
          <span className="col-span-2 text-right text-[11px] text-[var(--color-text-muted)] sm:col-auto sm:text-left">
            Showing {filteredStrikes.length} of {strikes.length} available strikes
          </span>
          <Button className="w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={downloadCsv} title="Export filtered option chain as CSV">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button className="w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={() => setShowBuildup(!showBuildup)}>
            <TrendingUp className="h-4 w-4" />
            {showBuildup ? "Hide Buildup" : "Show Buildup"}
          </Button>
          <Button className="col-span-2 w-full justify-center sm:w-auto" variant="outline" size="sm" onClick={() => setShowGreeks(!showGreeks)}>
            <Settings2 className="h-4 w-4" />
            {showGreeks ? "Hide Greeks" : "Show Greeks"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex items-start gap-1">
          <p className="text-xs text-[var(--color-text-secondary)]">
            Select up to {MAX_ANALYSIS_CONTRACTS} fixed or rolling Call/Put contracts for Greek comparison or combined-premium candles.
          </p>
          <EducationPopover title="Select contracts" description="Use the chart icon for a fixed strike, or add a rolling ATM/OTM/ITM descriptor. Rolling selections follow the current expiry's strike ladder as spot changes." tips={["You can compare up to 10 selections.", "A mix of calls, puts, fixed, and rolling selections is supported."]} links={[{ label: "Options chain and Greeks overview", href: "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks" }]} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBasketOpen(true)} disabled={basketLegs.length === 0}>
            <ShoppingCart className="h-4 w-4" /> Basket ({basketLegs.length})
          </Button>
          <Button variant="outline" size="sm" onClick={openOpenInterestAnalysis} disabled={!expiry}>
            <BarChart3 className="h-4 w-4" /> Open Interest
          </Button>
          <span className="tnum text-xs font-semibold text-[var(--color-text-muted)]">{analysisSelections.length}/{MAX_ANALYSIS_CONTRACTS} selected</span>
          <Button variant="outline" size="sm" onClick={openCombinedPremiumAnalysis} disabled={analysisSelections.length === 0}>
            <BarChart3 className="h-4 w-4" /> Combined Premium
          </Button>
          <Button variant="secondary" size="sm" onClick={openStrikeAnalysis} disabled={analysisSelections.length === 0}>
            <BarChart3 className="h-4 w-4" /> Analyze Greeks
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2 sm:px-4">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Dynamic strike</span>
        <Select aria-label="Dynamic option side" value={dynamicOptionType} onChange={(event) => setDynamicOptionType(event.target.value as "CE" | "PE")} className="h-8 w-20 text-xs">
          <option value="CE">Call</option><option value="PE">Put</option>
        </Select>
        <Select aria-label="Dynamic strike moneyness" value={dynamicMoneyness} onChange={(event) => setDynamicMoneyness(event.target.value as DynamicMoneyness)} className="h-8 w-20 text-xs">
          <option value="ATM">ATM</option><option value="OTM">OTM</option><option value="ITM">ITM</option>
        </Select>
        {dynamicMoneyness !== "ATM" && <Select aria-label="Dynamic strike offset" value={dynamicOffset} onChange={(event) => setDynamicOffset(Number(event.target.value))} className="h-8 w-20 text-xs">
          {[1, 2, 3, 4, 5].map((offset) => <option key={offset} value={offset}>{dynamicMoneyness} {offset}</option>)}
        </Select>}
        <Button variant="outline" size="sm" onClick={addDynamicAnalysisSelection} disabled={analysisSelections.length >= MAX_ANALYSIS_CONTRACTS}>
          <Plus className="h-4 w-4" /> Add rolling
        </Button>
        {analysisSelections.length > 0 && <div className="flex flex-wrap items-center gap-1">
          {analysisSelections.map((selection) => <Badge key={selection.id} tone={selection.kind === "dynamic" ? "blue" : "neutral"}>
            {selection.kind === "dynamic" ? dynamicSelectionLabel(selection) : (instruments.find((item) => item.trading_symbol === selection.tradingSymbol)?.strike?.toLocaleString() ?? selection.tradingSymbol)}
            <button type="button" aria-label={`Remove ${selection.kind === "dynamic" ? dynamicSelectionLabel(selection) : selection.tradingSymbol}`} onClick={() => removeAnalysisSelection(selection.id)} className="ml-1 inline-flex align-middle"><X className="h-3 w-3" /></button>
          </Badge>)}
        </div>}
      </div>

      {error && (
        <div className="bg-[var(--color-accent-orange)]/10 px-4 py-2 text-xs font-medium text-[var(--color-accent-orange)]">
          {error}
        </div>
      )}
      <div className="divide-y divide-[var(--color-border-subtle)] lg:hidden">
        {filteredStrikes.map((row) => {
          const ceTick = row.CE ? getTick(row.CE.trading_symbol) : null;
          const peTick = row.PE ? getTick(row.PE.trading_symbol) : null;
          const isATM = row.strike === atmStrike;
          const ceBuildup = classifyBuildup(ceTick?.change_percent, row.CE?.oi_change_percent);
          const peBuildup = classifyBuildup(peTick?.change_percent, row.PE?.oi_change_percent);
          const ceOiChange = oiSnapshotChange(row.CE);
          const peOiChange = oiSnapshotChange(row.PE);
          const ceIV = showGreeks && ceTick?.last_price
            ? calculateImpliedVolatility("CE", S, row.strike, T, r, ceTick.last_price)
            : 0;
          const peIV = showGreeks && peTick?.last_price
            ? calculateImpliedVolatility("PE", S, row.strike, T, r, peTick.last_price)
            : 0;
          const ceDelta = ceIV > 0 ? calculateGreeks("CE", S, row.strike, T, r, ceIV).delta : null;
          const peDelta = peIV > 0 ? calculateGreeks("PE", S, row.strike, T, r, peIV).delta : null;

          return (
            <article
              key={row.strike}
              className={cn("p-3", isATM && "bg-[var(--color-accent-blue)]/5")}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="tnum text-sm font-bold text-[var(--color-text-bright)]">
                  {row.strike.toLocaleString()} Strike
                </span>
                {isATM && <Badge tone="blue">ATM</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { label: "CALL", tick: ceTick, instrument: row.CE, oiChange: ceOiChange, buildup: ceBuildup, iv: ceIV, delta: ceDelta, tone: "profit" as const },
                  { label: "PUT", tick: peTick, instrument: row.PE, oiChange: peOiChange, buildup: peBuildup, iv: peIV, delta: peDelta, tone: "loss" as const },
                ]).map((side) => (
                  <div key={side.label} className="min-w-0 rounded-lg bg-[var(--color-bg-tertiary)] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-[10px] font-bold tracking-wider", side.tone === "profit" ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]")}>{side.label}</span>
                      <span className={cn("tnum text-[10px] font-semibold", side.tick && side.tick.change_percent > 0 ? "text-[var(--color-profit)]" : side.tick && side.tick.change_percent < 0 ? "text-[var(--color-loss)]" : "text-[var(--color-text-muted)]")}>
                        {side.tick ? `${side.tick.change_percent > 0 ? "+" : ""}${side.tick.change_percent.toFixed(2)}%` : "—"}
                      </span>
                    </div>
                    <p className="tnum mt-1 flex items-center gap-1.5 text-base font-bold text-[var(--color-text-bright)]">
                      {side.tick ? formatINR(side.tick.last_price) : "—"}
                      {side.tick?.source && (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            side.tick.source === "real" ? "bg-[var(--color-profit)]" : "bg-[var(--color-text-muted)]"
                          )}
                          title={side.tick.source === "real" ? "Real broker price" : "Modeled (Black-Scholes)"}
                        />
                      )}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
                      <span>OI <b className="tnum text-[var(--color-text-secondary)]">{side.instrument?.oi?.toLocaleString() ?? "—"}</b></span>
                      <span>Vol <b className="tnum text-[var(--color-text-secondary)]">{side.tick?.volume.toLocaleString() ?? "—"}</b></span>
                      <span className={cn("tnum", side.oiChange && side.oiChange > 0 ? "text-[var(--color-profit)]" : side.oiChange && side.oiChange < 0 ? "text-[var(--color-loss)]" : "text-[var(--color-text-muted)]")}>OI Δ {side.oiChange == null ? "—" : `${side.oiChange > 0 ? "+" : ""}${side.oiChange.toLocaleString()}`}</span>
                      {showGreeks && <span className="tnum">IV {side.iv > 0 ? `${(side.iv * 100).toFixed(1)}%` : "—"}</span>}
                      {showGreeks && <span className="tnum">Δ {side.delta?.toFixed(2) ?? "—"}</span>}
                    </div>
                    {showBuildup && side.buildup && <div className="mt-2"><Badge tone={side.buildup.tone}>{side.buildup.shortLabel}</Badge></div>}
                    {side.instrument && <div className="mt-3 flex gap-2">
                      <Button
                        className="flex-1 bg-[var(--color-profit)] text-white hover:opacity-90"
                        size="sm"
                        onClick={() => setOrderTarget({ instrument: side.instrument!, side: "Buy" })}
                      >
                        <ShoppingCart className="h-3.5 w-3.5" /> Buy
                      </Button>
                      <Button
                        className="flex-1 border-[var(--color-loss)]/40 text-[var(--color-loss)] hover:bg-[var(--color-loss)]/10"
                        variant="outline"
                        size="sm"
                        onClick={() => setOrderTarget({ instrument: side.instrument!, side: "Sell" })}
                      >
                        <TrendingDown className="h-3.5 w-3.5" /> Sell
                      </Button>
                      <Button
                        variant={basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) ? "secondary" : "outline"}
                        size="sm"
                        title={basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) ? "Remove contract from basket" : "Add contract to basket"}
                        onClick={() => addBasketLeg(side.instrument)}
                        disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) && basketLegs.length >= MAX_ANALYSIS_CONTRACTS}
                      >
                        <Plus className="h-3.5 w-3.5" /> {basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) ? "In basket" : "Basket"}
                      </Button>
                      <Button
                        className="flex-1"
                        variant={selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => toggleAnalysisContract(side.instrument)}
                        disabled={!selectedAnalysisSymbols.includes(side.instrument.trading_symbol) && analysisSelections.length >= MAX_ANALYSIS_CONTRACTS}
                      >
                        {selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? <Check className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
                        {selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? "Selected" : "Select"}
                      </Button>
                    </div>}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
        {filteredStrikes.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">No strikes match the selected filters.</p>
        )}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="min-w-[1100px] w-full text-right text-xs">
          {/* Table Header */}
          <thead className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
            <tr>
              <th colSpan={(showGreeks ? 5 : 0) + (showBuildup ? 1 : 0) + 5} className="border-b border-r border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-profit)]">CALLS</th>
              <th className="border-b border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-text-primary)]">STRIKE</th>
              <th colSpan={(showGreeks ? 5 : 0) + (showBuildup ? 1 : 0) + 5} className="border-b border-l border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-loss)]">PUTS</th>
            </tr>
            <tr className="border-b border-[var(--color-border-default)]">
              {showGreeks && (
                <>
                  <th className="px-3 py-2 font-medium">Vega</th>
                  <th className="px-3 py-2 font-medium">Theta</th>
                  <th className="px-3 py-2 font-medium">Gamma</th>
                  <th className="px-3 py-2 font-medium">Delta</th>
                  <th className="px-3 py-2 font-medium">IV%</th>
                </>
              )}
              {showBuildup && <th className="px-3 py-2 font-medium">Buildup</th>}
              <th className="px-3 py-2 font-medium">OI</th>
              <th className="px-3 py-2 font-medium">OI Δ</th>
              <th className="px-3 py-2 font-medium">Vol</th>
              <th className="px-3 py-2 font-medium">Chg%</th>
              <th className="border-r border-[var(--color-border-default)] px-3 py-2 font-medium">LTP</th>

              <th className="bg-[var(--color-bg-secondary)] px-3 py-2 text-center font-medium">Strike</th>

              <th className="border-l border-[var(--color-border-default)] px-3 py-2 font-medium">LTP</th>
              <th className="px-3 py-2 font-medium">Chg%</th>
              <th className="px-3 py-2 font-medium">Vol</th>
              <th className="px-3 py-2 font-medium">OI</th>
              <th className="px-3 py-2 font-medium">OI Δ</th>
              {showBuildup && <th className="px-3 py-2 font-medium">Buildup</th>}
              {showGreeks && (
                <>
                  <th className="px-3 py-2 font-medium">IV%</th>
                  <th className="px-3 py-2 font-medium">Delta</th>
                  <th className="px-3 py-2 font-medium">Gamma</th>
                  <th className="px-3 py-2 font-medium">Theta</th>
                  <th className="px-3 py-2 font-medium">Vega</th>
                </>
              )}
            </tr>
          </thead>
          
          {/* Table Body */}
          <tbody className="tnum divide-y divide-[var(--color-border-subtle)] font-mono text-[var(--color-text-primary)]">
            {filteredStrikes.map((row) => {
              const ceTick = row.CE ? getTick(row.CE.trading_symbol) : null;
              const peTick = row.PE ? getTick(row.PE.trading_symbol) : null;
              const isATM = row.strike === atmStrike;

              // ITM logic
              const ceIsITM = row.strike < atmStrike;
              const peIsITM = row.strike > atmStrike;

              // Greeks logic
              let ceIV = 0, peIV = 0;
              let ceGreeks: Greeks | null = null;
              let peGreeks: Greeks | null = null;

              if (showGreeks) {
                if (ceTick && ceTick.last_price > 0) {
                  ceIV = calculateImpliedVolatility("CE", S, row.strike, T, r, ceTick.last_price);
                  ceGreeks = calculateGreeks("CE", S, row.strike, T, r, ceIV);
                }
                if (peTick && peTick.last_price > 0) {
                  peIV = calculateImpliedVolatility("PE", S, row.strike, T, r, peTick.last_price);
                  peGreeks = calculateGreeks("PE", S, row.strike, T, r, peIV);
                }
              }

              const ceBuildup = classifyBuildup(ceTick?.change_percent, row.CE?.oi_change_percent);
              const peBuildup = classifyBuildup(peTick?.change_percent, row.PE?.oi_change_percent);
              const ceOiChange = oiSnapshotChange(row.CE);
              const peOiChange = oiSnapshotChange(row.PE);

              return (
                <tr key={row.strike} className={cn("hover:bg-[var(--color-bg-hover)] transition-colors", isATM && "border-y-2 border-[var(--color-accent-blue)]")}>
                  {/* CALL GREEKS */}
                  {showGreeks && (
                    <>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {ceGreeks ? ceGreeks.vega.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {ceGreeks ? ceGreeks.theta.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {ceGreeks ? ceGreeks.gamma.toFixed(4) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 font-medium", ceIsITM ? "bg-[var(--color-accent-yellow)]/5 text-[var(--color-profit)]" : "text-[var(--color-text-secondary)]")}>
                        {ceGreeks ? ceGreeks.delta.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 font-medium", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {ceIV > 0 ? (ceIV * 100).toFixed(1) : "-"}
                      </td>
                    </>
                  )}
                  {/* CALLS */}
                  {showBuildup && (
                    <td className={cn("px-3 py-2 text-center", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                      {ceBuildup ? (
                        <Badge tone={ceBuildup.tone} title={ceBuildup.category}>
                          {ceBuildup.shortLabel}
                        </Badge>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">-</span>
                      )}
                    </td>
                  )}
                  <td className={cn("px-3 py-2", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", ceOiChange && ceOiChange > 0 ? "bg-[var(--color-profit)]/10 text-[var(--color-profit)]" : ceOiChange && ceOiChange < 0 ? "bg-[var(--color-loss)]/10 text-[var(--color-loss)]" : "")}>
                    {row.CE?.oi != null ? row.CE.oi.toLocaleString() : "-"}
                  </td>
                  <td className={cn("px-3 py-2", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", ceOiChange && ceOiChange > 0 ? "text-[var(--color-profit)]" : ceOiChange && ceOiChange < 0 ? "text-[var(--color-loss)]" : "text-[var(--color-text-muted)]")}>
                    {ceOiChange == null ? "—" : `${ceOiChange > 0 ? "+" : ""}${ceOiChange.toLocaleString()}`}
                  </td>
                  <td className={cn("px-3 py-2", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    {ceTick?.volume.toLocaleString() || "-"}
                  </td>
                  <td className={cn("px-3 py-2", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", ceTick && ceTick.change_percent > 0 ? "text-[var(--color-profit)]" : ceTick && ceTick.change_percent < 0 ? "text-[var(--color-loss)]" : "")}>
                    {ceTick ? `${ceTick.change_percent > 0 ? '+' : ''}${ceTick.change_percent.toFixed(2)}%` : "-"}
                  </td>
                  <td className={cn("border-r border-[var(--color-border-default)] px-3 py-2 font-semibold", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    <div className="flex items-center justify-end gap-1.5">
                      {ceTick ? formatINR(ceTick.last_price) : "-"}
                      {ceTick?.source && (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            ceTick.source === "real" ? "bg-[var(--color-profit)]" : "bg-[var(--color-text-muted)]"
                          )}
                          title={ceTick.source === "real" ? "Real broker price" : "Modeled (Black-Scholes)"}
                        />
                      )}
                      {row.CE && <button
                        type="button"
                        aria-label={`Buy ${row.CE.trading_symbol}`}
                        onClick={() => setOrderTarget({ instrument: row.CE!, side: "Buy" })}
                        className="rounded p-1 text-[var(--color-profit)] hover:bg-[var(--color-profit)]/10"
                      ><ShoppingCart className="h-3 w-3" /></button>}
                      {row.CE && <button
                        type="button"
                        aria-label={`Sell ${row.CE.trading_symbol}`}
                        title={`Sell ${row.CE.trading_symbol}`}
                        onClick={() => setOrderTarget({ instrument: row.CE!, side: "Sell" })}
                        className="rounded p-1 text-[var(--color-loss)] hover:bg-[var(--color-loss)]/10"
                      ><TrendingDown className="h-3 w-3" /></button>}
                      {row.CE && <button
                        type="button"
                        aria-label={`${basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) ? "Remove" : "Add"} ${row.CE.trading_symbol} ${basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) ? "from" : "to"} basket`}
                        onClick={() => addBasketLeg(row.CE)}
                        disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) && basketLegs.length >= MAX_ANALYSIS_CONTRACTS}
                        className={cn("rounded p-1", basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                      ><Plus className="h-3 w-3" /></button>}
                      {row.CE && <button
                        type="button"
                        aria-label={`${selectedAnalysisSymbols.includes(row.CE.trading_symbol) ? "Remove" : "Select"} ${row.CE.trading_symbol} for Greek analysis`}
                        onClick={() => toggleAnalysisContract(row.CE)}
                        disabled={!selectedAnalysisSymbols.includes(row.CE.trading_symbol) && analysisSelections.length >= MAX_ANALYSIS_CONTRACTS}
                        className={cn("rounded p-1", selectedAnalysisSymbols.includes(row.CE.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                      >{selectedAnalysisSymbols.includes(row.CE.trading_symbol) ? <Check className="h-3 w-3" /> : <BarChart3 className="h-3 w-3" />}</button>}
                    </div>
                  </td>

                  {/* STRIKE */}
                  <td className={cn("bg-[var(--color-bg-secondary)] px-3 py-2 text-center font-bold", isATM ? "text-[var(--color-accent-blue)]" : "")}>
                    {row.strike.toLocaleString()}
                  </td>

                  {/* PUTS */}
                  <td className={cn("border-l border-[var(--color-border-default)] px-3 py-2 font-semibold", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    <div className="flex items-center gap-1.5">
                      {row.PE && <button
                        type="button"
                        aria-label={`${selectedAnalysisSymbols.includes(row.PE.trading_symbol) ? "Remove" : "Select"} ${row.PE.trading_symbol} for Greek analysis`}
                        onClick={() => toggleAnalysisContract(row.PE)}
                        disabled={!selectedAnalysisSymbols.includes(row.PE.trading_symbol) && analysisSelections.length >= MAX_ANALYSIS_CONTRACTS}
                        className={cn("rounded p-1", selectedAnalysisSymbols.includes(row.PE.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                      >{selectedAnalysisSymbols.includes(row.PE.trading_symbol) ? <Check className="h-3 w-3" /> : <BarChart3 className="h-3 w-3" />}</button>}
                      {row.PE && <button
                        type="button"
                        aria-label={`Buy ${row.PE.trading_symbol}`}
                        onClick={() => setOrderTarget({ instrument: row.PE!, side: "Buy" })}
                        className="rounded p-1 text-[var(--color-profit)] hover:bg-[var(--color-profit)]/10"
                      ><ShoppingCart className="h-3 w-3" /></button>}
                      {row.PE && <button
                        type="button"
                        aria-label={`Sell ${row.PE.trading_symbol}`}
                        title={`Sell ${row.PE.trading_symbol}`}
                        onClick={() => setOrderTarget({ instrument: row.PE!, side: "Sell" })}
                        className="rounded p-1 text-[var(--color-loss)] hover:bg-[var(--color-loss)]/10"
                      ><TrendingDown className="h-3 w-3" /></button>}
                      {row.PE && <button
                        type="button"
                        aria-label={`${basketLegs.some(leg => leg.instrument.trading_symbol === row.PE!.trading_symbol) ? "Remove" : "Add"} ${row.PE.trading_symbol} ${basketLegs.some(leg => leg.instrument.trading_symbol === row.PE!.trading_symbol) ? "from" : "to"} basket`}
                        onClick={() => addBasketLeg(row.PE)}
                        disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === row.PE!.trading_symbol) && basketLegs.length >= MAX_ANALYSIS_CONTRACTS}
                        className={cn("rounded p-1", basketLegs.some(leg => leg.instrument.trading_symbol === row.PE!.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                      ><Plus className="h-3 w-3" /></button>}
                      {peTick ? formatINR(peTick.last_price) : "-"}
                      {peTick?.source && (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            peTick.source === "real" ? "bg-[var(--color-profit)]" : "bg-[var(--color-text-muted)]"
                          )}
                          title={peTick.source === "real" ? "Real broker price" : "Modeled (Black-Scholes)"}
                        />
                      )}
                    </div>
                  </td>
                  <td className={cn("px-3 py-2", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", peTick && peTick.change_percent > 0 ? "text-[var(--color-profit)]" : peTick && peTick.change_percent < 0 ? "text-[var(--color-loss)]" : "")}>
                    {peTick ? `${peTick.change_percent > 0 ? '+' : ''}${peTick.change_percent.toFixed(2)}%` : "-"}
                  </td>
                  <td className={cn("px-3 py-2", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    {peTick?.volume.toLocaleString() || "-"}
                  </td>
                  <td className={cn("px-3 py-2", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", peOiChange && peOiChange > 0 ? "bg-[var(--color-profit)]/10 text-[var(--color-profit)]" : peOiChange && peOiChange < 0 ? "bg-[var(--color-loss)]/10 text-[var(--color-loss)]" : "")}>
                    {row.PE?.oi != null ? row.PE.oi.toLocaleString() : "-"}
                  </td>
                  <td className={cn("px-3 py-2", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "", peOiChange && peOiChange > 0 ? "text-[var(--color-profit)]" : peOiChange && peOiChange < 0 ? "text-[var(--color-loss)]" : "text-[var(--color-text-muted)]")}>
                    {peOiChange == null ? "—" : `${peOiChange > 0 ? "+" : ""}${peOiChange.toLocaleString()}`}
                  </td>
                  {showBuildup && (
                    <td className={cn("px-3 py-2 text-center", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                      {peBuildup ? (
                        <Badge tone={peBuildup.tone} title={peBuildup.category}>
                          {peBuildup.shortLabel}
                        </Badge>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">-</span>
                      )}
                    </td>
                  )}
                  {/* PUT GREEKS */}
                  {showGreeks && (
                    <>
                      <td className={cn("px-3 py-2 font-medium", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {peIV > 0 ? (peIV * 100).toFixed(1) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 font-medium", peIsITM ? "bg-[var(--color-accent-yellow)]/5 text-[var(--color-loss)]" : "text-[var(--color-text-secondary)]")}>
                        {peGreeks ? peGreeks.delta.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {peGreeks ? peGreeks.gamma.toFixed(4) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {peGreeks ? peGreeks.theta.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 text-[var(--color-text-muted)]", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {peGreeks ? peGreeks.vega.toFixed(2) : "-"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {filteredStrikes.length === 0 && (
              <tr>
                <td colSpan={(showGreeks ? 10 : 0) + (showBuildup ? 2 : 0) + 11} className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
                  No strikes match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {orderTarget && (
        <BuyTicketModal
          symbol={symbol}
          instrument={orderTarget.instrument}
          tick={getTick(orderTarget.instrument.trading_symbol)}
          initialSide={orderTarget.side}
          onClose={() => setOrderTarget(null)}
        />
      )}
      {basketOpen && (
        <BasketOrderModal
          symbol={symbol}
          legs={basketLegs}
          risk={basketRisk}
          priceFor={(tradingSymbol) => getTick(tradingSymbol)?.last_price}
          onChange={setBasketLegs}
          onRiskChange={setBasketRisk}
          onClose={() => setBasketOpen(false)}
        />
      )}
    </div>
  );
}
