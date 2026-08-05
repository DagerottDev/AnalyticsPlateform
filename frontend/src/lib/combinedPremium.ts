import type { OHLCVData } from "@/lib/indicators";
import type { MarketTick } from "@/types/market";
import type { HistoricalCandle } from "@/lib/market";
import {
  dynamicSelectionLabel,
  resolveSelection,
  resolvedSelectionLabel,
  type AnalysisSelection,
  type ResolvedOptionSelection,
  type ResolvedSelectionPaths,
  type RollingSelectionMode,
} from "@/lib/analysisSelections";
import type { Instrument } from "@/types/market";

type TimedCandle = OHLCVData & { time: string | number };

export interface PremiumStrikeSummary {
  selectionLabel: string;
  currentLabel: string;
  historicalSourceLabel: string | null;
}

function formatStrike(strike: number): string {
  return strike.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Describes the actual strikes feeding one fixed or rolling premium leg. */
export function premiumStrikeSummary(
  selection: AnalysisSelection,
  currentResolution: ResolvedOptionSelection | null,
  historicalPath: Record<string, ResolvedOptionSelection> = {},
): PremiumStrikeSummary {
  const sourceStrikes = Array.from(new Set(
    Object.values(historicalPath).flatMap((resolution) => resolution.components
      .map(({ instrument }) => instrument.strike)
      .filter((strike): strike is number => typeof strike === "number" && Number.isFinite(strike)))
  )).sort((left, right) => left - right);
  const historicalSourceLabel = selection.kind === "dynamic" && sourceStrikes.length > 0
    ? `${sourceStrikes.length === 1
      ? formatStrike(sourceStrikes[0])
      : `${formatStrike(sourceStrikes[0])}–${formatStrike(sourceStrikes[sourceStrikes.length - 1])}`} ${selection.optionType} source strike${sourceStrikes.length === 1 ? "" : "s"} (${sourceStrikes.length})`
    : null;

  return {
    selectionLabel: selection.kind === "dynamic" ? dynamicSelectionLabel(selection) : "Fixed contract",
    currentLabel: resolvedSelectionLabel(currentResolution),
    historicalSourceLabel,
  };
}

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

export function resolvedLivePremium(resolution: ResolvedOptionSelection | null, ticks: Record<string, MarketTick>): number | null {
  if (!resolution) return null;
  let premium = 0;
  for (const { instrument, weight } of resolution.components) {
    const price = ticks[instrument.trading_symbol]?.last_price;
    if (!Number.isFinite(price) || !price || price <= 0) return null;
    premium += price * weight;
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
  selections?: AnalysisSelection[],
  fixedInstruments: Record<string, Instrument> = {},
  expiryInstruments: Instrument[] = [],
  mode: RollingSelectionMode = "raw",
): OHLCVData[] {
  if (selectionIds.length === 0) return [];
  const bySymbolAndTime = new Map(Object.entries(candlesBySymbol).map(([symbol, candles]) => [
    symbol,
    new Map(candles.map((candle) => [candle.timestamp, candle])),
  ]));
  return underlyingCandles.flatMap((underlying) => {
    const selectionCandle = (id: string): OHLCVData | null => {
      const selection = selections?.find((item) => item.id === id);
      const resolve = (spot: number) => mode === "smooth" && selection
        ? resolveSelection(selection, fixedInstruments, expiryInstruments, spot, mode)
        : paths[id]?.[underlying.timestamp];
      const value = (field: "open" | "high" | "low" | "close" | "volume", spot: number): number | null => {
        const resolution = resolve(spot);
        if (!resolution) return null;
        let total = 0;
        for (const { instrument, weight } of resolution.components) {
          const candle = bySymbolAndTime.get(instrument.trading_symbol)?.get(underlying.timestamp);
          const raw = candle?.[field] ?? 0;
          if (!Number.isFinite(raw) || (field !== "volume" && raw <= 0)) return null;
          total += raw * weight;
        }
        return total;
      };
      const open = value("open", underlying.open);
      const close = value("close", underlying.close);
      const high = value("high", underlying.high);
      const low = value("low", underlying.low);
      const volume = value("volume", underlying.close);
      if (open == null || close == null || high == null || low == null || volume == null) return null;
      return { time: toEpochSeconds(underlying.timestamp)!, open, close, high: Math.max(open, close, high), low: Math.min(open, close, low), volume };
    };
    const candles = selectionIds.map(selectionCandle);
    if (candles.some((candle) => !candle)) return [];
    const resolvedCandles = candles as OHLCVData[];
    return [{
      time: toEpochSeconds(underlying.timestamp)!,
      open: resolvedCandles.reduce((sum, candle) => sum + candle.open, 0),
      high: resolvedCandles.reduce((sum, candle) => sum + candle.high, 0),
      low: resolvedCandles.reduce((sum, candle) => sum + candle.low, 0),
      close: resolvedCandles.reduce((sum, candle) => sum + candle.close, 0),
      volume: resolvedCandles.reduce((sum, candle) => sum + (candle.volume || 0), 0),
    }];
  });
}
