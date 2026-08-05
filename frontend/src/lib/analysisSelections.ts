import { nearestStrikeTo } from "@/lib/optionMath";
import type { HistoricalCandle } from "@/lib/market";
import type { Instrument } from "@/types/market";

export const MAX_ANALYSIS_SELECTIONS = 10;
export const MAX_DYNAMIC_HISTORY_CONTRACTS = 40;

export type DynamicMoneyness = "ATM" | "OTM" | "ITM";
export type RollingSelectionMode = "smooth" | "raw";

export interface FixedOptionSelection {
  kind: "fixed";
  id: string;
  tradingSymbol: string;
}

export interface DynamicOptionSelection {
  kind: "dynamic";
  id: string;
  optionType: "CE" | "PE";
  moneyness: DynamicMoneyness;
  offset: number;
}

export type AnalysisSelection = FixedOptionSelection | DynamicOptionSelection;
export interface WeightedInstrument {
  instrument: Instrument;
  weight: number;
}

/** An exact broker contract in Raw mode, or an analytic blended contract in
 * Smooth mode. Smooth resolutions are chart/Greek inputs only and are never
 * used as an order symbol. */
export interface ResolvedOptionSelection {
  components: WeightedInstrument[];
  effectiveStrike: number;
  optionType: "CE" | "PE" | null;
  mode: RollingSelectionMode;
}

export type ResolvedSelectionPaths = Record<string, Record<string, ResolvedOptionSelection>>;

export function fixedSelection(tradingSymbol: string): FixedOptionSelection {
  return { kind: "fixed", id: `fixed:${tradingSymbol}`, tradingSymbol };
}

export function dynamicSelection(
  optionType: "CE" | "PE",
  moneyness: DynamicMoneyness,
  offset = 0,
): DynamicOptionSelection {
  const validOffset = moneyness === "ATM" ? 0 : Math.min(5, Math.max(1, Math.trunc(offset)));
  return {
    kind: "dynamic",
    id: `dynamic:${optionType}:${moneyness}:${validOffset}`,
    optionType,
    moneyness,
    offset: validOffset,
  };
}

export function dynamicSelectionLabel(selection: DynamicOptionSelection): string {
  return selection.moneyness === "ATM"
    ? `ATM ${selection.optionType}`
    : `${selection.moneyness} ${selection.offset} ${selection.optionType}`;
}

/** Compact, validated URL encoding: CE:ATM:0,PE:OTM:2. */
export function serializeDynamicSelections(selections: DynamicOptionSelection[]): string {
  return selections.map((selection) => `${selection.optionType}:${selection.moneyness}:${selection.offset}`).join(",");
}

export function parseDynamicSelections(value: string | null, maxSelections = MAX_ANALYSIS_SELECTIONS): DynamicOptionSelection[] {
  const parsed: DynamicOptionSelection[] = [];
  for (const token of (value || "").split(",")) {
    const [optionType, moneyness, rawOffset] = token.trim().toUpperCase().split(":");
    const offset = Number(rawOffset);
    if ((optionType !== "CE" && optionType !== "PE") || (moneyness !== "ATM" && moneyness !== "OTM" && moneyness !== "ITM")) continue;
    if (!Number.isInteger(offset) || offset < 0 || offset > 5 || (moneyness === "ATM" && offset !== 0) || (moneyness !== "ATM" && offset === 0)) continue;
    const selection = dynamicSelection(optionType, moneyness, offset);
    if (!parsed.some((item) => item.id === selection.id)) parsed.push(selection);
    if (parsed.length >= maxSelections) break;
  }
  return parsed;
}

export function parseFixedSelections(value: string | null, maxSelections = MAX_ANALYSIS_SELECTIONS): FixedOptionSelection[] {
  return Array.from(new Set((value || "").split(",").map((symbol) => symbol.trim()).filter(Boolean)))
    .slice(0, maxSelections)
    .map(fixedSelection);
}

/** Resolve a rolling descriptor against the expiry's actual strike ladder.
 * We intentionally return null at a boundary; substituting another strike
 * would make an OTM/ITM analysis look valid while using the wrong contract. */
export function resolveDynamicSelection(
  selection: DynamicOptionSelection,
  instruments: Instrument[],
  spot: number,
): Instrument | null {
  if (!Number.isFinite(spot) || instruments.length === 0) return null;
  const strikes = Array.from(new Set(instruments
    .map((instrument) => instrument.strike)
    .filter((strike): strike is number => typeof strike === "number" && Number.isFinite(strike))))
    .sort((left, right) => left - right);
  if (strikes.length === 0) return null;
  const atm = nearestStrikeTo(strikes, spot);
  const atmIndex = strikes.indexOf(atm);
  const direction = selection.moneyness === "ATM" ? 0 : (
    (selection.optionType === "CE") === (selection.moneyness === "OTM") ? 1 : -1
  );
  const targetStrike = strikes[atmIndex + direction * selection.offset];
  if (targetStrike === undefined) return null;
  return instruments.find((instrument) => instrument.option_type === selection.optionType && instrument.strike === targetStrike) ?? null;
}

function exactResolution(instrument: Instrument, mode: RollingSelectionMode): ResolvedOptionSelection {
  return {
    components: [{ instrument, weight: 1 }],
    effectiveStrike: instrument.strike ?? 0,
    optionType: instrument.option_type ?? null,
    mode,
  };
}

function strikeLadder(instruments: Instrument[]): number[] {
  return Array.from(new Set(instruments
    .map((instrument) => instrument.strike)
    .filter((strike): strike is number => typeof strike === "number" && Number.isFinite(strike))))
    .sort((left, right) => left - right);
}

/** Interpolate a rolling descriptor between the two strikes surrounding spot.
 * The same offset is applied to each bracket endpoint, which makes OTM/ITM
 * rolls continuous as the underlying moves through a strike. */
export function resolveSmoothDynamicSelection(
  selection: DynamicOptionSelection,
  instruments: Instrument[],
  spot: number,
): ResolvedOptionSelection | null {
  if (!Number.isFinite(spot)) return null;
  const strikes = strikeLadder(instruments);
  if (strikes.length === 0) return null;
  const exactIndex = strikes.findIndex((strike) => strike === spot);
  const direction = selection.moneyness === "ATM" ? 0 : (
    (selection.optionType === "CE") === (selection.moneyness === "OTM") ? 1 : -1
  );
  const source = (index: number) => instruments.find((instrument) => (
    instrument.option_type === selection.optionType && instrument.strike === strikes[index]
  ));
  if (exactIndex >= 0) {
    const exact = source(exactIndex + direction * selection.offset);
    return exact ? exactResolution(exact, "smooth") : null;
  }
  const upperIndex = strikes.findIndex((strike) => strike > spot);
  if (upperIndex <= 0) return null;
  const lowerIndex = upperIndex - 1;
  const lower = source(lowerIndex + direction * selection.offset);
  const upper = source(upperIndex + direction * selection.offset);
  if (!lower || !upper || lower.strike == null || upper.strike == null) return null;
  const span = strikes[upperIndex] - strikes[lowerIndex];
  if (span <= 0) return null;
  const upperWeight = (spot - strikes[lowerIndex]) / span;
  const lowerWeight = 1 - upperWeight;
  return {
    components: [{ instrument: lower, weight: lowerWeight }, { instrument: upper, weight: upperWeight }],
    effectiveStrike: lower.strike * lowerWeight + upper.strike * upperWeight,
    optionType: selection.optionType,
    mode: "smooth",
  };
}

export function resolveSelection(
  selection: AnalysisSelection,
  fixedInstruments: Record<string, Instrument>,
  expiryInstruments: Instrument[],
  spot: number,
  mode: RollingSelectionMode,
): ResolvedOptionSelection | null {
  if (selection.kind === "fixed") {
    const instrument = fixedInstruments[selection.tradingSymbol];
    return instrument ? exactResolution(instrument, mode) : null;
  }
  if (mode === "smooth") return resolveSmoothDynamicSelection(selection, expiryInstruments, spot);
  const instrument = resolveDynamicSelection(selection, expiryInstruments, spot);
  return instrument ? exactResolution(instrument, "raw") : null;
}

export function resolvedSelectionLabel(resolution: ResolvedOptionSelection | null): string {
  if (!resolution) return "Unavailable at current spot";
  const parts = resolution.components.map(({ instrument, weight }) => {
    const strike = instrument.strike?.toLocaleString("en-IN") ?? "—";
    return resolution.components.length === 1 ? `${strike} ${instrument.option_type ?? "OPT"}` : `${strike} ${instrument.option_type ?? "OPT"} ${(weight * 100).toFixed(0)}%`;
  });
  return parts.join(" + ");
}

function pathTimeSeconds(timestamp: string): number | null {
  const numeric = Number(timestamp);
  if (timestamp.trim() && Number.isFinite(numeric)) return numeric;
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : null;
}

/** Resolve the strike selection represented by the nearest historical candle. */
export function resolvedSelectionAtTime(
  path: Record<string, ResolvedOptionSelection>,
  time: number | null,
): ResolvedOptionSelection | null {
  if (time === null || !Number.isFinite(time)) return null;
  let nearest: ResolvedOptionSelection | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [timestamp, resolution] of Object.entries(path)) {
    const candidateTime = pathTimeSeconds(timestamp);
    if (candidateTime === null) continue;
    const distance = Math.abs(candidateTime - time);
    if (distance < nearestDistance) {
      nearest = resolution;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function buildResolvedSelectionPaths(
  selections: AnalysisSelection[],
  fixedInstruments: Record<string, Instrument>,
  expiryInstruments: Instrument[],
  underlyingCandles: HistoricalCandle[],
  mode: RollingSelectionMode = "raw",
): ResolvedSelectionPaths {
  const paths: ResolvedSelectionPaths = {};
  for (const selection of selections) {
    const path: Record<string, ResolvedOptionSelection> = {};
    for (const candle of underlyingCandles) {
      const resolution = resolveSelection(selection, fixedInstruments, expiryInstruments, candle.close, mode);
      if (resolution) path[candle.timestamp] = resolution;
    }
    paths[selection.id] = path;
  }
  return paths;
}

export function instrumentsRequiredByPaths(
  paths: ResolvedSelectionPaths,
  selections: AnalysisSelection[] = [],
  fixedInstruments: Record<string, Instrument> = {},
  expiryInstruments: Instrument[] = [],
  underlyingCandles: HistoricalCandle[] = [],
  mode: RollingSelectionMode = "raw",
): Instrument[] {
  const bySymbol = new Map<string, Instrument>();
  for (const path of Object.values(paths)) {
    for (const resolution of Object.values(path)) {
      for (const { instrument } of resolution.components) bySymbol.set(instrument.trading_symbol, instrument);
    }
  }
  // A Smooth synthetic OHLC uses a distinct underlying price for each field.
  // Include any extra bracket contracts touched by intrabar high/low/open
  // before histories are fetched, rather than silently dropping that candle.
  if (mode === "smooth") {
    for (const selection of selections) {
      for (const candle of underlyingCandles) {
        for (const spot of [candle.open, candle.high, candle.low, candle.close]) {
          const resolution = resolveSelection(selection, fixedInstruments, expiryInstruments, spot, mode);
          for (const { instrument } of resolution?.components ?? []) bySymbol.set(instrument.trading_symbol, instrument);
        }
      }
    }
  }
  return Array.from(bySymbol.values());
}

export function currentResolvedSelections(
  selections: AnalysisSelection[],
  fixedInstruments: Record<string, Instrument>,
  expiryInstruments: Instrument[],
  spot: number,
  mode: RollingSelectionMode = "raw",
): Record<string, ResolvedOptionSelection | null> {
  return Object.fromEntries(selections.map((selection) => [
    selection.id,
    resolveSelection(selection, fixedInstruments, expiryInstruments, spot, mode),
  ]));
}
