import { describe, it, expect } from "vitest";
import { buildReplaySession } from "../lib/replayEngine";
import { HistoricalCandle } from "../lib/market";
import { Instrument } from "../types/market";

function makeCandle(overrides: Partial<HistoricalCandle>): HistoricalCandle {
  return {
    timestamp: "2026-07-21T03:45:00+00:00",
    open: 22000,
    high: 22010,
    low: 21990,
    close: 22000,
    volume: 1000,
    open_interest: 0,
    ...overrides,
  };
}

const farExpiry = "31-Dec-2099";

describe("buildReplaySession", () => {
  it("returns no ticks when there are no candles", () => {
    const { allTicks } = buildReplaySession("NIFTY", [], [], 0.15);
    expect(allTicks).toEqual([]);
  });

  it("drives the underlying tick directly from the real candle close price", () => {
    const candles = [
      makeCandle({ timestamp: "2026-07-21T03:45:00+00:00", close: 22000, volume: 1000 }),
      makeCandle({ timestamp: "2026-07-21T03:46:00+00:00", close: 22100, volume: 1200 }),
    ];
    const { allTicks } = buildReplaySession("NIFTY", candles, [], 0.15);

    expect(allTicks.length).toBe(2);
    expect(allTicks[0]["NIFTY"].last_price).toBe(22000);
    expect(allTicks[0]["NIFTY"].change).toBe(0);
    expect(allTicks[1]["NIFTY"].last_price).toBe(22100);
    expect(allTicks[1]["NIFTY"].volume).toBe(1200);
  });

  it("prices option instruments off the real spot with Black-Scholes", () => {
    const candles = [makeCandle({ close: 22000 })];
    const instruments: Instrument[] = [
      {
        trading_symbol: "NSE:NIFTY99DEC2222000CE",
        symbol: "NIFTY",
        instrument_type: "OPTIDX",
        expiry: farExpiry,
        strike: 22000,
        option_type: "CE",
        exchange: "NFO",
      },
    ];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);

    const tick = allTicks[0]["NSE:NIFTY99DEC2222000CE"];
    expect(tick).toBeDefined();
    expect(tick.last_price).toBeGreaterThan(0);
  });

  it("skips instruments missing strike, option_type, or expiry", () => {
    const candles = [makeCandle({})];
    const instruments: Instrument[] = [
      {
        trading_symbol: "INCOMPLETE",
        symbol: "NIFTY",
        instrument_type: "OPTIDX",
        expiry: null,
        strike: 22000,
        option_type: "CE",
        exchange: "NFO",
      },
    ];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);
    expect(allTicks[0]["INCOMPLETE"]).toBeUndefined();
  });
});
