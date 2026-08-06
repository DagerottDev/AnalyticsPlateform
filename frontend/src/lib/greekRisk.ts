import { calculateGreeks, calculateImpliedVolatility, calculateOptionPrice, type Greeks } from "@/lib/greeks";
import { timeToExpiry } from "@/lib/optionMath";
import type { Instrument, MarketTick } from "@/types/market";

export type RiskSide = "Buy" | "Sell";
export interface RiskLeg { instrument: Instrument; side: RiskSide; quantity: number; }
export interface PricedRiskLeg extends RiskLeg { premium: number; iv: number; greeks: Greeks; quoteQuality: "mid" | "ltp"; }
export type RiskExposure = Record<Exclude<keyof Greeks, "price">, number>;
export interface ScenarioResult { label: string; spotMove: number; ivMove: number; days: number; approximatePnl: number; repricedPnl: number; difference: number; }

const EMPTY: RiskExposure = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, vomma: 0, charm: 0, speed: 0, color: 0, zomma: 0, ultima: 0 };

export function quotePrice(tick: MarketTick | undefined): { price: number; quality: "mid" | "ltp" } | null {
  if (tick && Number.isFinite(tick.bid) && Number.isFinite(tick.ask) && tick.bid! > 0 && tick.ask! >= tick.bid!) return { price: (tick.bid! + tick.ask!) / 2, quality: "mid" };
  if (tick && Number.isFinite(tick.last_price) && tick.last_price > 0) return { price: tick.last_price, quality: "ltp" };
  return null;
}

export function priceRiskLegs(legs: RiskLeg[], spot: number, ticks: Record<string, MarketTick>, riskFreeRate: number, atMs = Date.now()): PricedRiskLeg[] {
  return legs.flatMap((leg) => {
    if (!leg.instrument.strike || !leg.instrument.option_type || leg.quantity <= 0) return [];
    const quote = quotePrice(ticks[leg.instrument.trading_symbol]);
    if (!quote) return [];
    const years = timeToExpiry(leg.instrument.expiry, atMs);
    const iv = calculateImpliedVolatility(leg.instrument.option_type, spot, leg.instrument.strike, years, riskFreeRate, quote.price);
    if (!Number.isFinite(iv) || iv <= 0) return [];
    return [{ ...leg, premium: quote.price, iv, greeks: calculateGreeks(leg.instrument.option_type, spot, leg.instrument.strike, years, riskFreeRate, iv), quoteQuality: quote.quality }];
  });
}

export function aggregateRiskExposure(legs: PricedRiskLeg[]): RiskExposure {
  const result = { ...EMPTY };
  for (const leg of legs) {
    const sign = leg.side === "Buy" ? 1 : -1;
    const multiplier = sign * leg.quantity;
    for (const key of Object.keys(result) as Array<keyof RiskExposure>) result[key] += leg.greeks[key] * multiplier;
  }
  return result;
}

export function atr14(candles: Array<{ high: number; low: number; close: number }>): number | null {
  if (candles.length < 2) return null;
  const ranges = candles.slice(1).map((candle, index) => Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index].close), Math.abs(candle.low - candles[index].close))).filter(Number.isFinite);
  if (!ranges.length) return null;
  return ranges.slice(-14).reduce((sum, value) => sum + value, 0) / Math.min(14, ranges.length);
}

export function scenarioResults(legs: PricedRiskLeg[], spot: number, atr: number, riskFreeRate: number, atMs = Date.now()): ScenarioResult[] {
  const scenarios = [
    { label: "−1 ATR / IV −1", spotMove: -atr, ivMove: -0.01, days: 1 },
    { label: "Base / 1 day", spotMove: 0, ivMove: 0, days: 1 },
    { label: "+1 ATR / IV +1", spotMove: atr, ivMove: 0.01, days: 1 },
  ];
  return scenarios.map((scenario) => {
    let approximatePnl = 0;
    let repricedPnl = 0;
    for (const leg of legs) {
      const multiplier = (leg.side === "Buy" ? 1 : -1) * leg.quantity;
      const { delta, gamma, vega, theta } = leg.greeks;
      const approximation = delta * scenario.spotMove + 0.5 * gamma * scenario.spotMove ** 2 + vega * (scenario.ivMove * 100) + theta * scenario.days;
      approximatePnl += approximation * multiplier;
      const years = Math.max(timeToExpiry(leg.instrument.expiry, atMs) - scenario.days / 365, 0.0001);
      const repriced = calculateOptionPrice(leg.instrument.option_type!, spot + scenario.spotMove, leg.instrument.strike!, years, riskFreeRate, Math.max(0.0001, leg.iv + scenario.ivMove));
      repricedPnl += (repriced - leg.premium) * multiplier;
    }
    return { ...scenario, approximatePnl, repricedPnl, difference: repricedPnl - approximatePnl };
  });
}
