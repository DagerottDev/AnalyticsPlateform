"use client";

import { useEffect, useState, useMemo } from "react";
import { Instrument } from "@/types/market";
import { getInstruments } from "@/lib/market";
import { useMarketData } from "@/hooks/useMarketData";
import { cn, formatINR } from "@/lib/utils";
import { Loader2, Settings2 } from "lucide-react";
import { calculateImpliedVolatility, calculateGreeks, Greeks } from "@/lib/greeks";

interface OptionChainProps {
  symbol: string;
  expiry: string | null;
}

export function OptionChain({ symbol, expiry }: OptionChainProps) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGreeks, setShowGreeks] = useState(true);

  // Fetch instruments when symbol or expiry changes
  useEffect(() => {
    let isMounted = true;
    if (!symbol || !expiry) return;

    async function fetchContracts() {
      setLoading(true);
      setError(null);
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          // Filter by expiry
          const filtered = data.instruments.filter((i) => i.expiry === expiry);
          setInstruments(filtered);
        }
      } catch (err) {
        if (isMounted) {
          setError("Failed to load option chain data. Showing mocked data.");
          // Create dummy instruments if backend fails
          const dummy: Instrument[] = [];
          const baseStrike = symbol === "NIFTY" ? 22000 : 48000;
          const step = symbol === "NIFTY" ? 50 : 100;
          for (let i = -10; i <= 10; i++) {
            const strike = baseStrike + i * step;
            dummy.push({
              trading_symbol: `${symbol}${expiry}${strike}CE`,
              symbol,
              instrument_type: "OPTIDX",
              expiry,
              strike,
              option_type: "CE",
              exchange: "NFO",
            });
            dummy.push({
              trading_symbol: `${symbol}${expiry}${strike}PE`,
              symbol,
              instrument_type: "OPTIDX",
              expiry,
              strike,
              option_type: "PE",
              exchange: "NFO",
            });
          }
          setInstruments(dummy);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchContracts();
    return () => {
      isMounted = false;
    };
  }, [symbol, expiry]);

  // Extract trading symbols for WebSocket subscription
  // Subscribe to live market data + underlying index
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const { getTick } = useMarketData(allSymbols);
  
  // Get underlying price
  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || (symbol === "NIFTY" ? 22000 : 48000); // fallback

  // Time to expiry (T) in years
  const T = useMemo(() => {
    if (!expiry) return 0.01; // fallback
    const expDate = new Date(expiry);
    const now = new Date();
    // Set time to end of trading day 3:30 PM IST
    expDate.setHours(15, 30, 0, 0);
    const diffMs = expDate.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return Math.max(diffDays / 365, 0.0001); // Avoid T=0
  }, [expiry]);
  
  const r = 0.10; // 10% risk-free rate for Indian markets

  // Group by strike price
  const strikes = useMemo(() => {
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

  // Find ATM strike (mock calculation: closest to mid-point of available strikes)
  const atmStrike = useMemo(() => {
    if (strikes.length === 0) return 0;
    const midIndex = Math.floor(strikes.length / 2);
    return strikes[midIndex].strike;
  }, [strikes]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent-blue)]" />
      </div>
    );
  }

  if (strikes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-muted)]">
        No contracts found for selected expiry.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            Underlying ({symbol}): <span className="font-bold text-[var(--color-text-bright)]">{formatINR(S)}</span>
          </span>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">
            DTE: <span className="font-bold text-[var(--color-text-bright)]">{(T * 365).toFixed(1)} days</span>
          </span>
        </div>
        <button
          onClick={() => setShowGreeks(!showGreeks)}
          className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-hover)]"
        >
          <Settings2 className="h-4 w-4" />
          {showGreeks ? "Hide Greeks" : "Show Greeks"}
        </button>
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
              <th colSpan={showGreeks ? 9 : 4} className="border-b border-r border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-accent-green)]">CALLS</th>
              <th className="border-b border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-text-primary)]">STRIKE</th>
              <th colSpan={showGreeks ? 9 : 4} className="border-b border-l border-[var(--color-border-default)] px-4 py-2 text-center font-semibold text-[var(--color-accent-red)]">PUTS</th>
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
              <th className="px-3 py-2 font-medium">OI</th>
              <th className="px-3 py-2 font-medium">Vol</th>
              <th className="px-3 py-2 font-medium">Chg%</th>
              <th className="border-r border-[var(--color-border-default)] px-3 py-2 font-medium">LTP</th>
              
              <th className="bg-[var(--color-bg-secondary)] px-3 py-2 text-center font-medium">Strike</th>
              
              <th className="border-l border-[var(--color-border-default)] px-3 py-2 font-medium">LTP</th>
              <th className="px-3 py-2 font-medium">Chg%</th>
              <th className="px-3 py-2 font-medium">Vol</th>
              <th className="px-3 py-2 font-medium">OI</th>
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
          <tbody className="divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)] font-mono">
            {strikes.map((row) => {
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
                      <td className={cn("px-3 py-2 font-medium", ceIsITM ? "bg-[var(--color-accent-yellow)]/5 text-[var(--color-accent-green)]" : "text-[var(--color-text-secondary)]")}>
                        {ceGreeks ? ceGreeks.delta.toFixed(2) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 font-medium", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {ceIV > 0 ? (ceIV * 100).toFixed(1) : "-"}
                      </td>
                    </>
                  )}
                  {/* CALLS */}
                  <td className={cn("px-3 py-2", ceIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    {ceTick?.open_interest.toLocaleString() || "-"}
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
                  <td className={cn("px-3 py-2", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                    {peTick?.open_interest.toLocaleString() || "-"}
                  </td>
                  {/* PUT GREEKS */}
                  {showGreeks && (
                    <>
                      <td className={cn("px-3 py-2 font-medium", peIsITM ? "bg-[var(--color-accent-yellow)]/5" : "")}>
                        {peIV > 0 ? (peIV * 100).toFixed(1) : "-"}
                      </td>
                      <td className={cn("px-3 py-2 font-medium", peIsITM ? "bg-[var(--color-accent-yellow)]/5 text-[var(--color-accent-red)]" : "text-[var(--color-text-secondary)]")}>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
