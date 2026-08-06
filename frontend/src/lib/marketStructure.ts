import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { timeToExpiry } from "@/lib/optionMath";
import { quotePrice } from "@/lib/greekRisk";
import type { Instrument, MarketTick } from "@/types/market";

export type MarketSignMode = "neutral" | "dealer-short" | "dealer-long";
export interface StructureStrike { strike: number; oi: number; oiChange: number; gamma: number; delta: number; vega: number; vanna: number; charm: number; complete: number; total: number; }

export function buildMarketStructure(instruments: Instrument[], ticks: Record<string, MarketTick>, spot: number, rate: number, signMode: MarketSignMode, atMs = Date.now()): StructureStrike[] {
  const byStrike = new Map<number, StructureStrike>();
  for (const instrument of instruments) {
    if (!instrument.strike || !instrument.option_type) continue;
    const existing = byStrike.get(instrument.strike) ?? { strike: instrument.strike, oi: 0, oiChange: 0, gamma: 0, delta: 0, vega: 0, vanna: 0, charm: 0, complete: 0, total: 0 };
    existing.total += 1;
    const quote = quotePrice(ticks[instrument.trading_symbol]);
    const oi = ticks[instrument.trading_symbol]?.open_interest || instrument.oi || 0;
    existing.oi += oi * (instrument.lot_size || 1);
    existing.oiChange += instrument.oi_change || 0;
    if (!quote || oi <= 0) { byStrike.set(instrument.strike, existing); continue; }
    const iv = calculateImpliedVolatility(instrument.option_type, spot, instrument.strike, timeToExpiry(instrument.expiry, atMs), rate, quote.price);
    if (!iv) { byStrike.set(instrument.strike, existing); continue; }
    const greek = calculateGreeks(instrument.option_type, spot, instrument.strike, timeToExpiry(instrument.expiry, atMs), rate, iv);
    const lotOi = oi * (instrument.lot_size || 1);
    // OI itself is unsigned. Hypothetical dealer modes only apply a clear
    // global sign and never infer call/put ownership from the chain.
    const sign = signMode === "neutral" ? 1 : signMode === "dealer-short" ? -1 : 1;
    existing.gamma += greek.gamma * lotOi * spot * spot * sign;
    existing.delta += greek.delta * lotOi * sign;
    existing.vega += greek.vega * lotOi * sign;
    existing.vanna += greek.vanna * lotOi * sign;
    existing.charm += greek.charm * lotOi * sign;
    existing.complete += 1;
    byStrike.set(instrument.strike, existing);
  }
  return Array.from(byStrike.values()).sort((left, right) => left.strike - right.strike);
}

export function gammaFlip(profile: StructureStrike[]): number | null {
  for (let index = 1; index < profile.length; index += 1) {
    const left = profile[index - 1]; const right = profile[index];
    if (left.gamma === 0) return left.strike;
    if (left.gamma * right.gamma < 0) return left.strike + ((0 - left.gamma) / (right.gamma - left.gamma)) * (right.strike - left.strike);
  }
  return null;
}
