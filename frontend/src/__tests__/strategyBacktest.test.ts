import { describe, expect, it } from "vitest";
import { runStrategyBacktest } from "../lib/strategyBacktest";
import type { StrategyLeg } from "../lib/strategy";

const callLeg: StrategyLeg = {
  id: "call",
  action: "Buy",
  quantity: 1,
  entryPrice: 0,
  iv: 0.2,
  instrument: {
    trading_symbol: "NIFTY22000CE",
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: null,
    strike: 22000,
    option_type: "CE",
    exchange: "NFO",
  },
};

describe("strategy backtest engine", () => {
  it("rolls non-overlapping historical positions and returns finite risk metrics", () => {
    const result = runStrategyBacktest(
      [callLeg],
      22000,
      [
        { timestamp: "2026-01-02T09:15:00Z", close: 22000 },
        { timestamp: "2026-01-05T09:15:00Z", close: 22100 },
        { timestamp: "2026-01-06T09:15:00Z", close: 22200 },
        { timestamp: "2026-01-07T09:15:00Z", close: 22400 },
        { timestamp: "2026-01-08T09:15:00Z", close: 22300 },
      ],
      { holdingDays: 2, daysToExpiry: 30 }
    );

    expect(result.trades).toHaveLength(2);
    expect(result.equityCurve).toHaveLength(2);
    expect(result.trades[0].pnl).toBeGreaterThan(0);
    expect(Number.isFinite(result.sharpeRatio)).toBe(true);
    expect(Number.isFinite(result.maxDrawdown)).toBe(true);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
  });
});
