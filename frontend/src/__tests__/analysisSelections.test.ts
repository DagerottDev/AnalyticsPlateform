import { describe, expect, it } from "vitest";
import {
  buildResolvedSelectionPaths,
  dynamicSelection,
  instrumentsRequiredByPaths,
  parseDynamicSelections,
  resolveDynamicSelection,
  resolveSmoothDynamicSelection,
  resolvedSelectionAtTime,
  resolvedSelectionLabel,
  serializeDynamicSelections,
} from "@/lib/analysisSelections";
import type { Instrument } from "@/types/market";

const ladder: Instrument[] = [100, 110, 120, 130, 140].flatMap((strike) => (["CE", "PE"] as const).map((optionType) => ({
  trading_symbol: `${strike}${optionType}`, symbol: "TEST", instrument_type: "OPT", expiry: "31-Dec-2030", strike, option_type: optionType, exchange: "NFO",
})));

describe("rolling option selections", () => {
  it("maps Call and Put OTM/ITM offsets in opposite directions from ATM", () => {
    expect(resolveDynamicSelection(dynamicSelection("CE", "ATM"), ladder, 116)?.trading_symbol).toBe("120CE");
    expect(resolveDynamicSelection(dynamicSelection("CE", "OTM", 1), ladder, 116)?.trading_symbol).toBe("130CE");
    expect(resolveDynamicSelection(dynamicSelection("CE", "ITM", 1), ladder, 116)?.trading_symbol).toBe("110CE");
    expect(resolveDynamicSelection(dynamicSelection("PE", "OTM", 1), ladder, 116)?.trading_symbol).toBe("110PE");
    expect(resolveDynamicSelection(dynamicSelection("PE", "ITM", 1), ladder, 116)?.trading_symbol).toBe("130PE");
  });

  it("does not substitute a strike when an offset leaves the ladder", () => {
    expect(resolveDynamicSelection(dynamicSelection("CE", "OTM", 1), ladder, 140)).toBeNull();
  });

  it("resolves each historical point independently and deduplicates sources", () => {
    const selection = dynamicSelection("CE", "ATM");
    const paths = buildResolvedSelectionPaths([selection], {}, ladder, [
      { timestamp: "2026-08-01T09:15:00Z", open: 104, high: 104, low: 104, close: 104, volume: 0, open_interest: 0 },
      { timestamp: "2026-08-01T09:20:00Z", open: 126, high: 126, low: 126, close: 126, volume: 0, open_interest: 0 },
    ]);
    expect(paths[selection.id]["2026-08-01T09:15:00Z"].components[0].instrument.trading_symbol).toBe("100CE");
    expect(paths[selection.id]["2026-08-01T09:20:00Z"].components[0].instrument.trading_symbol).toBe("130CE");
    expect(instrumentsRequiredByPaths(paths).map((item) => item.trading_symbol)).toEqual(["100CE", "130CE"]);
  });

  it("validates and round-trips dynamic URL descriptors", () => {
    const parsed = parseDynamicSelections("CE:ATM:0,PE:OTM:2,CE:ATM:0,PE:ITM:0,bad", 10);
    expect(parsed.map((selection) => selection.id)).toEqual(["dynamic:CE:ATM:0", "dynamic:PE:OTM:2"]);
    expect(serializeDynamicSelections(parsed)).toBe("CE:ATM:0,PE:OTM:2");
  });

  it("distance-weights adjacent rolling contracts in smooth mode", () => {
    const resolved = resolveSmoothDynamicSelection(dynamicSelection("CE", "OTM", 1), ladder, 115);
    expect(resolved?.components.map(({ instrument, weight }) => [instrument.trading_symbol, weight])).toEqual([
      ["120CE", 0.5], ["130CE", 0.5],
    ]);
    expect(resolved?.effectiveStrike).toBe(125);
    expect(resolvedSelectionLabel(resolved ?? null)).toContain("120 CE 50%");
  });

  it("keeps an exact strike at 100% and omits a smooth boundary overflow", () => {
    expect(resolveSmoothDynamicSelection(dynamicSelection("PE", "ATM"), ladder, 120)?.components).toHaveLength(1);
    expect(resolveSmoothDynamicSelection(dynamicSelection("CE", "OTM", 1), ladder, 135)).toBeNull();
  });

  it("finds the strike represented by a crosshair timestamp", () => {
    const selection = dynamicSelection("CE", "ATM");
    const paths = buildResolvedSelectionPaths([selection], {}, ladder, [
      { timestamp: "2026-08-01T09:15:00Z", open: 104, high: 104, low: 104, close: 104, volume: 0, open_interest: 0 },
      { timestamp: "2026-08-01T09:20:00Z", open: 126, high: 126, low: 126, close: 126, volume: 0, open_interest: 0 },
    ]);
    expect(resolvedSelectionAtTime(paths[selection.id], Date.parse("2026-08-01T09:20:00Z") / 1000)?.components[0].instrument.trading_symbol).toBe("130CE");
    expect(resolvedSelectionAtTime(paths[selection.id], Date.parse("2026-08-01T09:17:00Z") / 1000)?.components[0].instrument.trading_symbol).toBe("100CE");
    expect(resolvedSelectionAtTime(paths[selection.id], null)).toBeNull();
  });
});
