import { nearestStrikeTo } from "@/lib/optionMath";
import type { HistoricalCandle } from "@/lib/market";
import type { Instrument } from "@/types/market";

export const MAX_ANALYSIS_SELECTIONS = 10;
export const MAX_DYNAMIC_HISTORY_CONTRACTS = 40;

export type DynamicMoneyness = "ATM" | "OTM" | "ITM";

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
export type ResolvedSelectionPaths = Record<string, Record<string, Instrument>>;

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

export function buildResolvedSelectionPaths(
  selections: AnalysisSelection[],
  fixedInstruments: Record<string, Instrument>,
  expiryInstruments: Instrument[],
  underlyingCandles: HistoricalCandle[],
): ResolvedSelectionPaths {
  const paths: ResolvedSelectionPaths = {};
  for (const selection of selections) {
    const path: Record<string, Instrument> = {};
    if (selection.kind === "fixed") {
      const instrument = fixedInstruments[selection.tradingSymbol];
      if (instrument) for (const candle of underlyingCandles) path[candle.timestamp] = instrument;
    } else {
      for (const candle of underlyingCandles) {
        const instrument = resolveDynamicSelection(selection, expiryInstruments, candle.close);
        if (instrument) path[candle.timestamp] = instrument;
      }
    }
    paths[selection.id] = path;
  }
  return paths;
}

export function instrumentsRequiredByPaths(paths: ResolvedSelectionPaths): Instrument[] {
  const bySymbol = new Map<string, Instrument>();
  for (const path of Object.values(paths)) {
    for (const instrument of Object.values(path)) bySymbol.set(instrument.trading_symbol, instrument);
  }
  return Array.from(bySymbol.values());
}

export function currentResolvedInstruments(
  selections: AnalysisSelection[],
  fixedInstruments: Record<string, Instrument>,
  expiryInstruments: Instrument[],
  spot: number,
): Record<string, Instrument | null> {
  return Object.fromEntries(selections.map((selection) => [
    selection.id,
    selection.kind === "fixed"
      ? fixedInstruments[selection.tradingSymbol] ?? null
      : resolveDynamicSelection(selection, expiryInstruments, spot),
  ]));
}
