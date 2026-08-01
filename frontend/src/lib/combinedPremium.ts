import type { OHLCVData } from "@/lib/indicators";
import type { MarketTick } from "@/types/market";
import type { HistoricalCandle } from "@/lib/market";
import type { ResolvedSelectionPaths } from "@/lib/analysisSelections";

type TimedCandle = OHLCVData & { time: string | number };

function toEpochSeconds(time: TimedCandle["time"]): number | null {
  const value = typeof time === "number" ? time : Date.parse(time) / 1000;
  return Number.isFinite(value) ? value : null;
}

function validCandle(candle: TimedCandle): boolean {
  return [candle.open, candle.high, candle.low, candle.close].every(
    (value) => Number.isFinite(value) && value > 0
  );
}

/**
 * Forms a synthetic premium candle only where every component has a candle.
 * Using intersection rather than a partial sum keeps every point comparable:
 * a missing contract can never make a composite premium look smaller.
 */
export function combinePremiumCandles(series: OHLCVData[][]): OHLCVData[] {
  if (series.length === 0 || series.some((candles) => candles.length === 0)) return [];
  const maps = series.map((candles) => new Map(
    candles.flatMap((candle) => {
      const time = toEpochSeconds(candle.time);
      return time === null || !validCandle(candle) ? [] : [[time, candle] as const];
    })
  ));
  const first = maps[0];
  const result: OHLCVData[] = [];
  for (const [time] of first) {
    const components = maps.map((map) => map.get(time));
    if (components.some((candle) => candle === undefined)) continue;
    const candles = components as OHLCVData[];
    result.push({
      time,
      open: candles.reduce((sum, candle) => sum + candle.open, 0),
      high: candles.reduce((sum, candle) => sum + candle.high, 0),
      low: candles.reduce((sum, candle) => sum + candle.low, 0),
      close: candles.reduce((sum, candle) => sum + candle.close, 0),
      volume: candles.reduce((sum, candle) => sum + (candle.volume || 0), 0),
    });
  }
  return result.sort((left, right) => Number(left.time) - Number(right.time));
}

/** Return the raw-premium sum only when every contract has a current quote. */
export function combinedLivePremium(symbols: string[], ticks: Record<string, MarketTick>): number | null {
  if (symbols.length === 0) return null;
  let premium = 0;
  for (const symbol of symbols) {
    const price = ticks[symbol]?.last_price;
    if (!Number.isFinite(price) || !price || price <= 0) return null;
    premium += price;
  }
  return premium;
}

export function parseCombinedPremiumContracts(value: string | null, maxContracts = 10): string[] {
  return Array.from(new Set((value || "").split(",").map((symbol) => symbol.trim()).filter(Boolean))).slice(0, maxContracts);
}

/** Build premiums from the resolved contract at each point. This is used by
 * rolling ATM/OTM/ITM selections; all chosen legs must have a valid candle. */
export function combineResolvedPremiumCandles(
  selectionIds: string[],
  paths: ResolvedSelectionPaths,
  candlesBySymbol: Record<string, HistoricalCandle[]>,
  underlyingCandles: HistoricalCandle[],
): OHLCVData[] {
  if (selectionIds.length === 0) return [];
  const bySymbolAndTime = new Map(Object.entries(candlesBySymbol).map(([symbol, candles]) => [
    symbol,
    new Map(candles.map((candle) => [candle.timestamp, candle])),
  ]));
  return underlyingCandles.flatMap((underlying) => {
    const components = selectionIds.map((id) => {
      const instrument = paths[id]?.[underlying.timestamp];
      return instrument ? bySymbolAndTime.get(instrument.trading_symbol)?.get(underlying.timestamp) : undefined;
    });
    if (components.some((candle) => !candle)) return [];
    const candles = components as HistoricalCandle[];
    if (candles.some((candle) => ![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0))) return [];
    return [{
      time: toEpochSeconds(underlying.timestamp)!,
      open: candles.reduce((sum, candle) => sum + candle.open, 0),
      high: candles.reduce((sum, candle) => sum + candle.high, 0),
      low: candles.reduce((sum, candle) => sum + candle.low, 0),
      close: candles.reduce((sum, candle) => sum + candle.close, 0),
      volume: candles.reduce((sum, candle) => sum + (candle.volume || 0), 0),
    }];
  });
}
