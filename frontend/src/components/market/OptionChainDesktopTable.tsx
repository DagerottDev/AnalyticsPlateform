"use client";

import { BarChart3, Check, Plus, ShoppingCart, TrendingDown } from "lucide-react";
import { Instrument, MarketTick } from "@/types/market";
import { cn, formatINR } from "@/lib/utils";
import { calculateImpliedVolatility, calculateGreeks, Greeks } from "@/lib/greeks";
import { classifyBuildup } from "@/lib/buildup";
import { BasketLegDraft } from "@/lib/basket";
import { Badge } from "@/components/ui/Badge";
import type { OptionChainStrikeRow } from "@/lib/optionChainFilters";
import type { TicketSide } from "@/components/market/OptionChain";

interface OptionChainDesktopTableProps {
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

/** The lg+ desktop table half of the Option Chain's dual mobile/desktop
 * render — extracted verbatim from OptionChain.tsx to keep that file
 * focused on state/data-fetching. */
export function OptionChainDesktopTable({
  filteredStrikes, atmStrike, showGreeks, showBuildup, getTick, S, T, r,
  basketLegs, selectedAnalysisSymbols, analysisSelectionsCount, maxAnalysisContracts,
  oiSnapshotChange, setOrderTarget, addBasketLeg, toggleAnalysisContract,
}: OptionChainDesktopTableProps) {
  return (
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
                      disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) && basketLegs.length >= maxAnalysisContracts}
                      className={cn("rounded p-1", basketLegs.some(leg => leg.instrument.trading_symbol === row.CE!.trading_symbol) ? "bg-[var(--color-accent-blue)] text-white" : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]", "disabled:cursor-not-allowed disabled:opacity-40")}
                    ><Plus className="h-3 w-3" /></button>}
                    {row.CE && <button
                      type="button"
                      aria-label={`${selectedAnalysisSymbols.includes(row.CE.trading_symbol) ? "Remove" : "Select"} ${row.CE.trading_symbol} for Greek analysis`}
                      onClick={() => toggleAnalysisContract(row.CE)}
                      disabled={!selectedAnalysisSymbols.includes(row.CE.trading_symbol) && analysisSelectionsCount >= maxAnalysisContracts}
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
                      disabled={!selectedAnalysisSymbols.includes(row.PE.trading_symbol) && analysisSelectionsCount >= maxAnalysisContracts}
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
                      disabled={!basketLegs.some(leg => leg.instrument.trading_symbol === row.PE!.trading_symbol) && basketLegs.length >= maxAnalysisContracts}
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
  );
}
