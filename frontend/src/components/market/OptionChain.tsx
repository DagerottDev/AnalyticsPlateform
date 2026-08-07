"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Instrument } from "@/types/market";
import { getInstruments } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { formatApiError } from "@/lib/apiError";
import { BuyTicketModal } from "@/components/market/BuyTicketModal";
import { BasketOrderModal } from "@/components/market/BasketOrderModal";
import { OptionChainToolbar } from "@/components/market/OptionChainToolbar";
import { OptionChainMobileRows } from "@/components/market/OptionChainMobileRows";
import { OptionChainDesktopTable } from "@/components/market/OptionChainDesktopTable";
import { BasketLegDraft, BasketRiskDraft, orderBasketLegsForMargin } from "@/lib/basket";
import { daysToExpiry, timeToExpiry, nearestStrikeTo, defaultSpotFallback } from "@/lib/optionMath";
import {
  filterOptionChainStrikes,
  MoneynessFilter,
  OptionChainStrikeRow,
  toCsvCell,
} from "@/lib/optionChainFilters";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { useSettingsStore } from "@/stores/settingsStore";
// Backward-compatible re-export for consumers that previously imported this
// closed-market normalizer from the Option Chain module.
export { toClosedMarketQuote } from "@/lib/marketTick";
import {
  dynamicSelection,
  fixedSelection,
  MAX_ANALYSIS_SELECTIONS,
  serializeDynamicSelections,
  type AnalysisSelection,
  type DynamicMoneyness,
} from "@/lib/analysisSelections";

const MAX_ANALYSIS_CONTRACTS = MAX_ANALYSIS_SELECTIONS;
export type TicketSide = "Buy" | "Sell";

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
  // The backend websocket has one session-scoped, rate-limited REST quote
  // fallback for all browser tabs. A second Option-Chain-only REST poll here
  // created duplicate 40-symbol bursts and repeatedly hit Fyers' 429 limit,
  // leaving the entire table frozen. Keep this view on the shared feed.
  const { getTick } = useMarketData(allSymbols);

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
    if (previous != null) return instrument.oi - previous;
    // No local snapshot yet — right after a symbol/expiry switch, or during
    // the backend's up-to-5-minute instrument cache window, this otherwise
    // sits on "—" for a long time. Fall back to the broker's own OI change
    // (vs. previous day's close) so the column isn't empty in the meantime.
    return instrument.oi_change ?? null;
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
      "Symbol", "Expiry", "Strike", "Call OI", "Call OI change", "Call LTP", "Call volume", "Call change %",
      "Put LTP", "Put change %", "Put volume", "Put OI", "Put OI change",
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
      <OptionChainToolbar
        symbol={symbol}
        expiry={expiry}
        underlyingTick={underlyingTick}
        S={S}
        dte={dte}
        moneyness={moneyness}
        onMoneynessChange={setMoneyness}
        strikesEachSide={strikesEachSide}
        onStrikesEachSideChange={setStrikesEachSide}
        filteredStrikesCount={filteredStrikes.length}
        strikesCount={strikes.length}
        onDownloadCsv={downloadCsv}
        showBuildup={showBuildup}
        onToggleShowBuildup={() => setShowBuildup(!showBuildup)}
        showGreeks={showGreeks}
        onToggleShowGreeks={() => setShowGreeks(!showGreeks)}
        basketLegsCount={basketLegs.length}
        onOpenBasket={() => setBasketOpen(true)}
        onOpenOpenInterestAnalysis={openOpenInterestAnalysis}
        onOpenCombinedPremiumAnalysis={openCombinedPremiumAnalysis}
        onOpenStrikeAnalysis={openStrikeAnalysis}
        instruments={instruments}
        analysisSelections={analysisSelections}
        onRemoveAnalysisSelection={removeAnalysisSelection}
        dynamicOptionType={dynamicOptionType}
        onDynamicOptionTypeChange={setDynamicOptionType}
        dynamicMoneyness={dynamicMoneyness}
        onDynamicMoneynessChange={setDynamicMoneyness}
        dynamicOffset={dynamicOffset}
        onDynamicOffsetChange={setDynamicOffset}
        onAddDynamicAnalysisSelection={addDynamicAnalysisSelection}
      />

      {error && (
        <div className="bg-[var(--color-accent-orange)]/10 px-4 py-2 text-xs font-medium text-[var(--color-accent-orange)]">
          {error}
        </div>
      )}
      <OptionChainMobileRows
        filteredStrikes={filteredStrikes}
        atmStrike={atmStrike}
        showGreeks={showGreeks}
        showBuildup={showBuildup}
        getTick={getTick}
        S={S}
        T={T}
        r={r}
        basketLegs={basketLegs}
        selectedAnalysisSymbols={selectedAnalysisSymbols}
        analysisSelectionsCount={analysisSelections.length}
        maxAnalysisContracts={MAX_ANALYSIS_CONTRACTS}
        oiSnapshotChange={oiSnapshotChange}
        setOrderTarget={setOrderTarget}
        addBasketLeg={addBasketLeg}
        toggleAnalysisContract={toggleAnalysisContract}
      />
      <OptionChainDesktopTable
        filteredStrikes={filteredStrikes}
        atmStrike={atmStrike}
        showGreeks={showGreeks}
        showBuildup={showBuildup}
        getTick={getTick}
        S={S}
        T={T}
        r={r}
        basketLegs={basketLegs}
        selectedAnalysisSymbols={selectedAnalysisSymbols}
        analysisSelectionsCount={analysisSelections.length}
        maxAnalysisContracts={MAX_ANALYSIS_CONTRACTS}
        oiSnapshotChange={oiSnapshotChange}
        setOrderTarget={setOrderTarget}
        addBasketLeg={addBasketLeg}
        toggleAnalysisContract={toggleAnalysisContract}
      />
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
