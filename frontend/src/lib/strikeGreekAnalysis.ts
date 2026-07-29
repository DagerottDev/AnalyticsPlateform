import { calculateGreeks, calculateImpliedVolatility, type Greeks } from "@/lib/greeks";
import type { HistoricalCandle } from "@/lib/market";
import type { Instrument } from "@/types/market";

export type GreekMetric = Exclude<keyof Greeks, "price">;
export interface GreekPoint { time: string; value: number; }
export type GreekSeries = Record<GreekMetric, Record<string, GreekPoint[]>>;

export const FIRST_ORDER_GREEKS: GreekMetric[] = ["delta", "gamma", "theta", "vega", "rho"];
export const HIGHER_ORDER_GREEKS: GreekMetric[] = ["vanna", "vomma", "charm", "speed", "color", "zomma", "ultima"];

const EMPTY_SERIES = (): GreekSeries => ({
  delta: {}, gamma: {}, theta: {}, vega: {}, rho: {}, vanna: {}, vomma: {}, charm: {},
  speed: {}, color: {}, zomma: {}, ultima: {},
});

function expiryTime(expiry: string | null): number | null {
  if (!expiry) return null;
  const match = expiry.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]), 10, 0, 0);
}

/** Recalculate each selected contract's Greeks from matched historical option
 * and underlying candles. Values are omitted when IV cannot be solved rather
 * than substituting a fabricated volatility. */
export function buildStrikeGreekSeries(
  instruments: Instrument[],
  candlesBySymbol: Record<string, HistoricalCandle[]>,
  underlyingCandles: HistoricalCandle[]
): GreekSeries {
  const result = EMPTY_SERIES();
  const spotByTime = new Map(underlyingCandles.map((candle) => [candle.timestamp, candle.close]));
  for (const instrument of instruments) {
    if (!instrument.strike || !instrument.option_type) continue;
    const expiry = expiryTime(instrument.expiry);
    if (!expiry) continue;
    const series = candlesBySymbol[instrument.trading_symbol] ?? [];
    (Object.keys(result) as GreekMetric[]).forEach((metric) => {
      result[metric][instrument.trading_symbol] = [];
    });
    for (const candle of series) {
      const spot = spotByTime.get(candle.timestamp);
      const timestamp = new Date(candle.timestamp).getTime();
      if (!spot || !Number.isFinite(timestamp)) continue;
      const years = Math.max((expiry - timestamp) / (365 * 24 * 60 * 60 * 1000), 0.0001);
      const iv = calculateImpliedVolatility(instrument.option_type, spot, instrument.strike, years, 0.1, candle.close);
      if (iv <= 0) continue;
      const greeks = calculateGreeks(instrument.option_type, spot, instrument.strike, years, 0.1, iv);
      (Object.keys(result) as GreekMetric[]).forEach((metric) => {
        result[metric][instrument.trading_symbol].push({ time: candle.timestamp, value: greeks[metric] });
      });
    }
  }
  return result;
}

/** Each non-base contract divided by the selected base contract at shared times. */
export function buildGreekRatios(series: Record<string, GreekPoint[]>, baseSymbol: string): Record<string, GreekPoint[]> {
  const base = new Map((series[baseSymbol] ?? []).map((point) => [point.time, point.value]));
  return Object.fromEntries(Object.entries(series).flatMap(([symbol, points]) => {
    if (symbol === baseSymbol) return [];
    return [[symbol, points.flatMap((point) => {
      const denominator = base.get(point.time);
      return denominator == null || Math.abs(denominator) < 1e-12 ? [] : [{ time: point.time, value: point.value / denominator }];
    })]];
  }));
}
