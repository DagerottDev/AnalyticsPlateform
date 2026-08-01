import { calculateGreeks, calculateImpliedVolatility, type Greeks } from "@/lib/greeks";
import type { HistoricalCandle } from "@/lib/market";
import type { Instrument, MarketTick } from "@/types/market";
import type { ResolvedSelectionPaths } from "@/lib/analysisSelections";

export type GreekMetric = Exclude<keyof Greeks, "price">;
export interface GreekPoint { time: string; value: number; }
export type GreekSeries = Record<GreekMetric, Record<string, GreekPoint[]>>;
export type CombinedGreekSeries = Record<GreekMetric, GreekPoint[]>;

export interface LiveGreekCalculation {
  values: Record<GreekMetric, number>;
  timestamp: string;
  liveContracts: number;
  totalContracts: number;
}

export const FIRST_ORDER_GREEKS: GreekMetric[] = ["delta", "gamma", "theta", "vega", "rho"];
export const HIGHER_ORDER_GREEKS: GreekMetric[] = ["vanna", "vomma", "charm", "speed", "color", "zomma", "ultima"];

const EMPTY_SERIES = (): GreekSeries => ({
  delta: {}, gamma: {}, theta: {}, vega: {}, rho: {}, vanna: {}, vomma: {}, charm: {},
  speed: {}, color: {}, zomma: {}, ultima: {},
});

const EMPTY_COMBINED_SERIES = (): CombinedGreekSeries => ({
  delta: [], gamma: [], theta: [], vega: [], rho: [], vanna: [], vomma: [], charm: [],
  speed: [], color: [], zomma: [], ultima: [],
});

const EMPTY_GREEK_VALUES = (): Record<GreekMetric, number> => ({
  delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, vomma: 0, charm: 0,
  speed: 0, color: 0, zomma: 0, ultima: 0,
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
  underlyingCandles: HistoricalCandle[],
  riskFreeRate: number = 0.1,
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
      const iv = calculateImpliedVolatility(instrument.option_type, spot, instrument.strike, years, riskFreeRate, candle.close);
      if (iv <= 0) continue;
      const greeks = calculateGreeks(instrument.option_type, spot, instrument.strike, years, riskFreeRate, iv);
      (Object.keys(result) as GreekMetric[]).forEach((metric) => {
        result[metric][instrument.trading_symbol].push({ time: candle.timestamp, value: greeks[metric] });
      });
    }
  }
  return result;
}

/**
 * Greek series for fixed and rolling selections. A rolling path names the
 * exact broker contract in force at each underlying candle, so a descriptor
 * can move strikes without mixing a premium from one strike with Greeks from
 * another. Keys are selection ids (rather than trading symbols).
 */
export function buildResolvedGreekSeries(
  paths: ResolvedSelectionPaths,
  candlesBySymbol: Record<string, HistoricalCandle[]>,
  underlyingCandles: HistoricalCandle[],
  riskFreeRate: number = 0.1,
): GreekSeries {
  const result = EMPTY_SERIES();
  const optionBySymbolAndTime = new Map<string, Map<string, HistoricalCandle>>();
  for (const [symbol, candles] of Object.entries(candlesBySymbol)) {
    optionBySymbolAndTime.set(symbol, new Map(candles.map((candle) => [candle.timestamp, candle])));
  }
  for (const [selectionId, path] of Object.entries(paths)) {
    for (const metric of Object.keys(result) as GreekMetric[]) result[metric][selectionId] = [];
    for (const underlying of underlyingCandles) {
      const instrument = path[underlying.timestamp];
      if (!instrument?.strike || !instrument.option_type) continue;
      const option = optionBySymbolAndTime.get(instrument.trading_symbol)?.get(underlying.timestamp);
      const expiry = expiryTime(instrument.expiry);
      const timestamp = new Date(underlying.timestamp).getTime();
      if (!option || !expiry || !Number.isFinite(timestamp)) continue;
      const years = Math.max((expiry - timestamp) / (365 * 24 * 60 * 60 * 1000), 0.0001);
      const iv = calculateImpliedVolatility(instrument.option_type, underlying.close, instrument.strike, years, riskFreeRate, option.close);
      if (iv <= 0) continue;
      const greeks = calculateGreeks(instrument.option_type, underlying.close, instrument.strike, years, riskFreeRate, iv);
      for (const metric of Object.keys(result) as GreekMetric[]) {
        result[metric][selectionId].push({ time: underlying.timestamp, value: greeks[metric] });
      }
    }
  }
  return result;
}

/** Sum the selected contracts into one portfolio-like Greek line. Every
 * selected strike contributes one option contract. A timestamp is shown only
 * once every valid selected contract has a value, so the result never looks
 * like a complete aggregate when a leg is missing. */
export function combineGreekSeries(series: GreekSeries): CombinedGreekSeries {
  const result = EMPTY_COMBINED_SERIES();
  for (const metric of Object.keys(result) as GreekMetric[]) {
    const totalsByTime = new Map<string, number>();
    const countByTime = new Map<string, number>();
    const contractSeries = Object.values(series[metric]);
    for (const points of contractSeries) {
      for (const point of points) {
        totalsByTime.set(point.time, (totalsByTime.get(point.time) ?? 0) + point.value);
        countByTime.set(point.time, (countByTime.get(point.time) ?? 0) + 1);
      }
    }
    result[metric] = Array.from(totalsByTime, ([time, value]) => ({ time, value }))
      .filter(({ time }) => countByTime.get(time) === contractSeries.length)
      .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
  }
  return result;
}

/** Recalculate the combined Greek values from live underlying and option
 * quotes. A thinly traded contract can legitimately have no usable LTP or
 * implied volatility; it is omitted until a valid quote arrives instead of
 * blocking the whole workspace. The caller receives explicit coverage so it
 * never presents a partial aggregate as a full one. */
export function calculateLiveCombinedGreeks(
  instruments: Instrument[],
  underlyingSymbol: string,
  ticks: Record<string, MarketTick>,
  riskFreeRate: number = 0.1,
): LiveGreekCalculation | null {
  const underlyingTick = ticks[underlyingSymbol];
  const spot = underlyingTick?.last_price;
  if (!spot || !Number.isFinite(spot) || instruments.length === 0) return null;

  const values = EMPTY_GREEK_VALUES();
  const timestamps = [underlyingTick.timestamp];
  const now = Date.now();
  let liveContracts = 0;

  for (const instrument of instruments) {
    if (!instrument.strike || !instrument.option_type) continue;
    const expiry = expiryTime(instrument.expiry);
    const optionTick = ticks[instrument.trading_symbol];
    if (!expiry || !optionTick || !optionTick.last_price || !Number.isFinite(optionTick.last_price)) continue;

    const years = Math.max((expiry - now) / (365 * 24 * 60 * 60 * 1000), 0.0001);
    const iv = calculateImpliedVolatility(
      instrument.option_type,
      spot,
      instrument.strike,
      years,
      riskFreeRate,
      optionTick.last_price
    );
    if (!Number.isFinite(iv) || iv <= 0) continue;

    const greeks = calculateGreeks(instrument.option_type, spot, instrument.strike, years, riskFreeRate, iv);
    for (const metric of Object.keys(values) as GreekMetric[]) values[metric] += greeks[metric];
    timestamps.push(optionTick.timestamp);
    liveContracts += 1;
  }

  if (liveContracts === 0) return null;

  return {
    values,
    timestamp: new Date(Math.max(...timestamps, now)).toISOString(),
    liveContracts,
    totalContracts: instruments.length,
  };
}

/** Add or replace the latest complete live calculation while preserving an
 * ascending, de-duplicated time series required by lightweight-charts. */
export function appendLiveGreekValues(
  history: CombinedGreekSeries,
  live: LiveGreekCalculation | null
): CombinedGreekSeries {
  if (!live) return history;
  // lightweight-charts stores intraday timestamps at whole-second precision.
  // Use the same key here so multiple ticks within one second replace the
  // previous live value instead of producing duplicate chart times.
  const timestamp = new Date(live.timestamp);
  timestamp.setMilliseconds(0);
  const liveTime = timestamp.toISOString();
  const result = EMPTY_COMBINED_SERIES();
  for (const metric of Object.keys(result) as GreekMetric[]) {
    const byTime = new Map(history[metric].map((point) => [point.time, point.value]));
    byTime.set(liveTime, live.values[metric]);
    result[metric] = Array.from(byTime, ([time, value]) => ({ time, value }))
      .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
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
