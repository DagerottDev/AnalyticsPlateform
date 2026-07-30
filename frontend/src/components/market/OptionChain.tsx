"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Instrument } from "@/types/market";
import { getInstruments } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { formatApiError } from "@/lib/apiError";
import { cn, formatINR } from "@/lib/utils";
import { BarChart3, Check, Download, Settings2, TrendingUp } from "lucide-react";
import { calculateImpliedVolatility, calculateGreeks, Greeks } from "@/lib/greeks";
import { classifyBuildup } from "@/lib/buildup";
import { timeToExpiry, nearestStrikeTo, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
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

const REFRESH_INTERVAL_MS = 30_000;
const MAX_ANALYSIS_CONTRACTS = 10;

interface OptionChainProps {
  symbol: string;
  expiry: string | null;
}

export function OptionChain({ symbol, expiry }: OptionChainProps) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGreeks, setShowGreeks] = useState(true);
  const [showBuildup, setShowBuildup] = useState(true);
  const [moneyness, setMoneyness] = useState<MoneynessFilter>("all");
  const [strikesEachSide, setStrikesEachSide] = useState<number | null>(10);
  const [previousOiBySymbol, setPreviousOiBySymbol] = useState<Map<string, number>>(new Map());
  const [selectedAnalysisSymbols, setSelectedAnalysisSymbols] = useState<string[]>([]);
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
          if (!isBackground) setSelectedAnalysisSymbols([]);
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
    const interval = setInterval(() => fetchContracts(true), REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol, expiry]);

  // Extract trading symbols for WebSocket subscription
  // Subscribe to live market data + underlying index
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const { getTick } = useMarketData(allSymbols);
  
  // Get underlying price
  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || defaultSpotFallback(symbol);

  // Time to expiry (T) in years
  const T = useMemo(() => timeToExpiry(expiry), [expiry]);

  const r = DEFAULT_RISK_FREE_RATE; // 10% risk-free rate for Indian markets

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
    setSelectedAnalysisSymbols((current) => {
      if (current.includes(instrument.trading_symbol)) {
        return current.filter((symbol) => symbol !== instrument.trading_symbol);
      }
      return current.length >= MAX_ANALYSIS_CONTRACTS
        ? current
        : [...current, instrument.trading_symbol];
    });
  };

  const openStrikeAnalysis = () => {
    if (selectedAnalysisSymbols.length === 0) return;
    const params = new URLSearchParams({
      symbol,
      expiry: expiry ?? "",
      contracts: selectedAnalysisSymbols.join(","),
    });
    const href = `/chain/analysis?${params.toString()}`;
    const analysisWindow = window.open(href, "strike-analysis");
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
            DTE: <span className="tnum font-bold text-[var(--color-text-bright)]">{Math.round(T * 365)} days</span>
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
            Select up to {MAX_ANALYSIS_CONTRACTS} call or put contracts to compare option Greeks, higher-order Greeks, and Greek ratios.
          </p>
          <EducationPopover title="Select contracts" description="Use the chart icon beside any call or put premium to add it to the Greek workspace. Choose contracts from the same expiry when you want a like-for-like comparison." tips={["You can compare up to 10 contracts.", "A mix of calls and puts is supported."]} links={[{ label: "Options chain and Greeks overview", href: "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks" }]} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tnum text-xs font-semibold text-[var(--color-text-muted)]">{selectedAnalysisSymbols.length}/{MAX_ANALYSIS_CONTRACTS} selected</span>
          <Button variant="secondary" size="sm" onClick={openStrikeAnalysis} disabled={selectedAnalysisSymbols.length === 0}>
            <BarChart3 className="h-4 w-4" /> Analyze Greeks
          </Button>
        </div>
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
                    <p className="tnum mt-1 text-base font-bold text-[var(--color-text-bright)]">{side.tick ? formatINR(side.tick.last_price) : "—"}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
                      <span>OI <b className="tnum text-[var(--color-text-secondary)]">{side.instrument?.oi?.toLocaleString() ?? "—"}</b></span>
                      <span>Vol <b className="tnum text-[var(--color-text-secondary)]">{side.tick?.volume.toLocaleString() ?? "—"}</b></span>
                      <span className={cn("tnum", side.oiChange && side.oiChange > 0 ? "text-[var(--color-profit)]" : side.oiChange && side.oiChange < 0 ? "text-[var(--color-loss)]" : "text-[var(--color-text-muted)]")}>OI Δ {side.oiChange == null ? "—" : `${side.oiChange > 0 ? "+" : ""}${side.oiChange.toLocaleString()}`}</span>
                      {showGreeks && <span className="tnum">IV {side.iv > 0 ? `${(side.iv * 100).toFixed(1)}%` : "—"}</span>}
                      {showGreeks && <span className="tnum">Δ {side.delta?.toFixed(2) ?? "—"}</span>}
                    </div>
                    {showBuildup && side.buildup && <div className="mt-2"><Badge tone={side.buildup.tone}>{side.buildup.shortLabel}</Badge></div>}
                    {side.instrument && <Button
                      className="mt-3 w-full"
                      variant={selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleAnalysisContract(side.instrument)}
                      disabled={!selectedAnalysisSymbols.includes(side.instrument.trading_symbol) && selectedAnalysisSymbols.length >= MAX_ANALYSIS_CONTRACTS}
                    >
                      {selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? <Check className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
                      {selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? "Selected" : "Select"}
                    </Button>}
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
                      {row.CE && <button
                        type="button"
                        aria-label={`${selectedAnalysisSymbols.includes(row.CE.trading_symbol) ? "Remove" : "Select"} ${row.CE.trading_symbol} for Greek analysis`}
                        onClick={() => toggleAnalysisContract(row.CE)}
                        disabled={!selectedAnalysisSymbols.includes(row.CE.trading_symbol) && selectedAnalysisSymbols.length >= MAX_ANALYSIS_CONTRACTS}
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
                        disabled={!selectedAnalysisSymbols.includes(row.PE.trading_symbol) && selectedAnalysisSymbols.length >= MAX_ANALYSIS_CONTRACTS}
                        className={cn("rounded p-1", selectedAnalysisSymbols.includes(row.PE.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                      >{selectedAnalysisSymbols.includes(row.PE.trading_symbol) ? <Check className="h-3 w-3" /> : <BarChart3 className="h-3 w-3" />}</button>}
                      {peTick ? formatINR(peTick.last_price) : "-"}
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
    </div>
  );
}
