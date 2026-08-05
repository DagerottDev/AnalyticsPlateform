import { describe, expect, it } from "vitest";
import { combinePremiumCandles, combinedLivePremium, combineResolvedPremiumCandles, parseCombinedPremiumContracts, premiumStrikeSummary, resolvedLivePremium } from "@/lib/combinedPremium";
import { buildResolvedSelectionPaths, dynamicSelection, instrumentsRequiredByPaths } from "@/lib/analysisSelections";

describe("combined premium candles", () => {
  it("sums OHLC and volume only for timestamps present in every component", () => {
    const result = combinePremiumCandles([
      [
        { time: 100, open: 10, high: 14, low: 8, close: 12, volume: 100 },
        { time: 200, open: 12, high: 15, low: 11, close: 14, volume: 120 },
      ],
      [
        { time: 100, open: 20, high: 23, low: 19, close: 21, volume: 200 },
        { time: 300, open: 21, high: 24, low: 20, close: 22, volume: 220 },
      ],
    ]);
    expect(result).toEqual([{ time: 100, open: 30, high: 37, low: 27, close: 33, volume: 300 }]);
  });

  it("returns no composite candle for an empty or invalid component series", () => {
    expect(combinePremiumCandles([[], [{ time: 100, open: 1, high: 2, low: 1, close: 1 }]])).toEqual([]);
    expect(combinePremiumCandles([[{ time: 100, open: 0, high: 2, low: 1, close: 1 }]])).toEqual([]);
  });

  it("requires a current premium from every selected component", () => {
    const ticks = {
      CE: { last_price: 100, timestamp: 10 },
      PE: { last_price: 80, timestamp: 11 },
    } as never;
    expect(combinedLivePremium(["CE", "PE"], ticks)).toBe(180);
    expect(combinedLivePremium(["CE", "MISSING"], ticks)).toBeNull();
  });

  it("parses a unique, bounded contract list from the analysis URL", () => {
    expect(parseCombinedPremiumContracts("CE, PE,CE,,", 2)).toEqual(["CE", "PE"]);
  });

  it("builds a rolling premium candle from the contract resolved at each timestamp", () => {
    const result = combineResolvedPremiumCandles(["dynamic:CE:ATM:0"], {
      "dynamic:CE:ATM:0": {
        "2026-08-01T09:15:00Z": { components: [{ instrument: { trading_symbol: "CE100" }, weight: 1 }], effectiveStrike: 100, optionType: "CE", mode: "raw" },
        "2026-08-01T09:20:00Z": { components: [{ instrument: { trading_symbol: "CE110" }, weight: 1 }], effectiveStrike: 110, optionType: "CE", mode: "raw" },
      },
    } as never, {
      CE100: [{ timestamp: "2026-08-01T09:15:00Z", open: 10, high: 12, low: 9, close: 11, volume: 5, open_interest: 0 }],
      CE110: [{ timestamp: "2026-08-01T09:20:00Z", open: 20, high: 22, low: 19, close: 21, volume: 6, open_interest: 0 }],
    }, [
      { timestamp: "2026-08-01T09:15:00Z", open: 0, high: 0, low: 0, close: 0, volume: 0, open_interest: 0 },
      { timestamp: "2026-08-01T09:20:00Z", open: 0, high: 0, low: 0, close: 0, volume: 0, open_interest: 0 },
    ]);
    expect(result).toEqual([
      { time: 1785575700, open: 10, high: 12, low: 9, close: 11, volume: 5 },
      { time: 1785576000, open: 20, high: 22, low: 19, close: 21, volume: 6 },
    ]);
  });

  it("weights every live component and requires both smooth quotes", () => {
    const resolution = {
      components: [{ instrument: { trading_symbol: "CE100" }, weight: 0.25 }, { instrument: { trading_symbol: "CE110" }, weight: 0.75 }],
      effectiveStrike: 107.5, optionType: "CE", mode: "smooth" as const,
    } as never;
    expect(resolvedLivePremium(resolution, { CE100: { last_price: 10 }, CE110: { last_price: 30 } } as never)).toBe(25);
    expect(resolvedLivePremium(resolution, { CE100: { last_price: 10 } } as never)).toBeNull();
  });

  it("summarizes current and historical source strikes for a rolling leg", () => {
    const selection = dynamicSelection("CE", "ATM");
    const summary = premiumStrikeSummary(selection, {
      components: [{ instrument: { trading_symbol: "CE110", symbol: "TEST", instrument_type: "OPT", expiry: "31-Dec-2030", strike: 110, option_type: "CE", exchange: "NFO" }, weight: 1 }],
      effectiveStrike: 110,
      optionType: "CE",
      mode: "raw",
    } as never, {
      first: { components: [{ instrument: { trading_symbol: "CE100", symbol: "TEST", instrument_type: "OPT", expiry: "31-Dec-2030", strike: 100, option_type: "CE", exchange: "NFO" }, weight: 1 }], effectiveStrike: 100, optionType: "CE", mode: "raw" },
      second: { components: [{ instrument: { trading_symbol: "CE110", symbol: "TEST", instrument_type: "OPT", expiry: "31-Dec-2030", strike: 110, option_type: "CE", exchange: "NFO" }, weight: 1 }], effectiveStrike: 110, optionType: "CE", mode: "raw" },
    });

    expect(summary).toEqual({
      selectionLabel: "ATM CE",
      currentLabel: "110 CE",
      historicalSourceLabel: "100–110 CE source strikes (2)",
    });
  });

  it("builds a valid OHLC-aware smooth rolling candle and fetches intrabar sources", () => {
    const selection = dynamicSelection("CE", "ATM");
    const instruments = [100, 110, 120].map((strike) => ({ trading_symbol: `CE${strike}`, symbol: "TEST", instrument_type: "OPT", expiry: "31-Dec-2030", strike, option_type: "CE" as const, exchange: "NFO" }));
    const underlying = [{ timestamp: "2026-08-01T09:15:00Z", open: 101, high: 109, low: 101, close: 105, volume: 0, open_interest: 0 }];
    const paths = buildResolvedSelectionPaths([selection], {}, instruments, underlying, "smooth");
    const candles = {
      CE100: [{ timestamp: underlying[0].timestamp, open: 10, high: 12, low: 9, close: 11, volume: 100, open_interest: 0 }],
      CE110: [{ timestamp: underlying[0].timestamp, open: 30, high: 32, low: 29, close: 31, volume: 200, open_interest: 0 }],
    };
    const result = combineResolvedPremiumCandles([selection.id], paths, candles, underlying, [selection], {}, instruments, "smooth");
    expect(result[0]).toMatchObject({ open: 12, close: 21, high: 30, low: 11, volume: 150 });
    expect(instrumentsRequiredByPaths(paths, [selection], {}, instruments, underlying, "smooth").map((item) => item.trading_symbol)).toEqual(["CE100", "CE110"]);
  });
});
