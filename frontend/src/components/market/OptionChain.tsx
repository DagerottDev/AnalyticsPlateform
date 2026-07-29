"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Instrument } from "@/types/market";
import { getInstruments } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { formatApiError } from "@/lib/apiError";
import { cn, formatINR } from "@/lib/utils";
import { Download, Settings2, TrendingUp } from "lucide-react";
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

const REFRESH_INTERVAL_MS = 30_000;

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
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            Underlying ({symbol}): <span className="tnum font-bold text-[var(--color-text-bright)]">{formatINR(S)}</span>
          </span>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            DTE: <span className="tnum font-bold text-[var(--color-text-bright)]">{Math.round(T * 365)} days</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select
            aria-label="Filter option chain by moneyness"
            value={moneyness}
            onChange={(event) => setMoneyness(event.target.value as MoneynessFilter)}
            className="h-8 w-32 text-xs"
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
            className="h-8 w-36 text-xs"
          >
            <option value="all">All strikes</option>
            <option value="5">±5 strikes</option>
            <option value="10">±10 strikes</option>
            <option value="20">±20 strikes</option>
          </Select>
          <Button variant="outline" size="sm" onClick={downloadCsv} title="Export filtered option chain as CSV">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBuildup(!showBuildup)}>
            <TrendingUp className="h-4 w-4" />
            {showBuildup ? "Hide Buildup" : "Show Buildup"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowGreeks(!showGreeks)}>
            <Settings2 className="h-4 w-4" />
            {showGreeks ? "Hide Greeks" : "Show Greeks"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-[var(--color-accent-orange)]/10 px-4 py-2 text-xs font-medium text-[var(--color-accent-orange)]">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
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
                    {ceTick ? formatINR(ceTick.last_price) : "-"}
                  </td>

                  {/* STRIKE */}
                  <td className={cn("bg-[var(--color-bg-secondary)] px-3 py-2 text-center font-bold", isATM ? "text-[var(--color-accent-blue)]" : "")}>
                    {row.strike.toLocaleString()}
                  </td>

                  {/* PUTS */}
                  <td className={cn("border-l border-[var(--color-border-default)] px-3 py-2 font-semibold", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    {peTick ? formatINR(peTick.last_price) : "-"}
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
