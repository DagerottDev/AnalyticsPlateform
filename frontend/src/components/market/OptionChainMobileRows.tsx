"use client";

import { BarChart3, Check, Plus, ShoppingCart, TrendingDown } from "lucide-react";
import { Instrument, MarketTick } from "@/types/market";
import { cn, formatINR } from "@/lib/utils";
import { calculateImpliedVolatility, calculateGreeks } from "@/lib/greeks";
import { classifyBuildup } from "@/lib/buildup";
import { BasketLegDraft } from "@/lib/basket";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { OptionChainStrikeRow } from "@/lib/optionChainFilters";
import type { TicketSide } from "@/components/market/OptionChain";

interface OptionChainMobileRowsProps {
  filteredStrikes: OptionChainStrikeRow[];
  atmStrike: number;
  showGreeks: boolean;
  showBuildup: boolean;
  getTick: (symbol: string) => MarketTick | null;
  /** Spot, time-to-expiry (years), and risk-free rate — inputs to the per-row Greeks calc. */
  S: number;
  T: number;
  r: number;
  basketLegs: BasketLegDraft[];
  selectedAnalysisSymbols: string[];
  analysisSelectionsCount: number;
  maxAnalysisContracts: number;
  oiSnapshotChange: (instrument: Instrument | undefined) => number | null;
  setOrderTarget: (target: { instrument: Instrument; side: TicketSide } | null) => void;
  addBasketLeg: (instrument: Instrument | undefined) => void;
  toggleAnalysisContract: (instrument: Instrument | undefined) => void;
}

/** The <lg mobile-card half of the Option Chain's dual mobile/desktop
 * render — extracted verbatim from OptionChain.tsx to keep that file
 * focused on state/data-fetching. */
export function OptionChainMobileRows({
  filteredStrikes, atmStrike, showGreeks, showBuildup, getTick, S, T, r,
  basketLegs, selectedAnalysisSymbols, analysisSelectionsCount, maxAnalysisContracts,
  oiSnapshotChange, setOrderTarget, addBasketLeg, toggleAnalysisContract,
}: OptionChainMobileRowsProps) {
  return (
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
                      disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) && basketLegs.length >= maxAnalysisContracts}
                    >
                      <Plus className="h-3.5 w-3.5" /> {basketLegs.some(leg => leg.instrument.trading_symbol === side.instrument!.trading_symbol) ? "In basket" : "Basket"}
                    </Button>
                    <Button
                      className="flex-1"
                      variant={selectedAnalysisSymbols.includes(side.instrument.trading_symbol) ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleAnalysisContract(side.instrument)}
                      disabled={!selectedAnalysisSymbols.includes(side.instrument.trading_symbol) && analysisSelectionsCount >= maxAnalysisContracts}
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
  );
}
