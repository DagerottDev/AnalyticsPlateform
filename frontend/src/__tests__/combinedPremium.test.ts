import { describe, expect, it } from "vitest";
import { combinePremiumCandles, combinedLivePremium, combineResolvedPremiumCandles, parseCombinedPremiumContracts } from "@/lib/combinedPremium";

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
        "2026-08-01T09:15:00Z": { trading_symbol: "CE100" },
        "2026-08-01T09:20:00Z": { trading_symbol: "CE110" },
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
});
