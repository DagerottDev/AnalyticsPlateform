import { describe, it, expect, vi } from "vitest";
import * as market from "../lib/market";
import { buildReplaySession, enrichReplaySessionWithRealPrices } from "../lib/replayEngine";
import { HistoricalCandle } from "../lib/market";
import { Instrument } from "../types/market";

vi.mock("../lib/market", async () => {
  const actual = await vi.importActual<typeof import("../lib/market")>("../lib/market");
  return { ...actual, getHistoricalCandles: vi.fn() };
});

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

  it("marks the underlying real and every option synthetic by default", () => {
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

    expect(allTicks[0]["NIFTY"].source).toBe("real");
    expect(allTicks[0]["NSE:NIFTY99DEC2222000CE"].source).toBe("synthetic");
  });
});

describe("enrichReplaySessionWithRealPrices", () => {
  const instrument = (tradingSymbol: string, strike: number): Instrument => ({
    trading_symbol: tradingSymbol,
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: farExpiry,
    strike,
    option_type: "CE",
    exchange: "NFO",
  });

  it("overlays a real close price when the broker has history for the contract", async () => {
    const candles = [
      makeCandle({ timestamp: "2026-07-21T03:45:00+00:00", close: 22000 }),
      makeCandle({ timestamp: "2026-07-21T03:46:00+00:00", close: 22010 }),
    ];
    const instruments = [instrument("NSE:NIFTY99DEC2222000CE", 22000)];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);

    vi.mocked(market.getHistoricalCandles).mockResolvedValue([
      { timestamp: "2026-07-21T03:45:00+00:00", open: 100, high: 105, low: 98, close: 100, volume: 500, open_interest: 0 },
      { timestamp: "2026-07-21T03:46:00+00:00", open: 100, high: 108, low: 99, close: 106, volume: 620, open_interest: 0 },
    ]);

    const coverage = await enrichReplaySessionWithRealPrices("NIFTY", allTicks, instruments, "2026-07-21", "1");

    expect(coverage).toEqual({ attempted: 1, matched: 1 });
    expect(allTicks[0]["NSE:NIFTY99DEC2222000CE"]).toMatchObject({ last_price: 100, source: "real" });
    expect(allTicks[1]["NSE:NIFTY99DEC2222000CE"]).toMatchObject({ last_price: 106, source: "real", change: 6 });
  });

  it("keeps the synthetic price when the broker returns no history for the contract", async () => {
    const candles = [makeCandle({ close: 22000 })];
    const instruments = [instrument("NSE:NIFTY99DEC2222000CE", 22000)];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);
    const syntheticPrice = allTicks[0]["NSE:NIFTY99DEC2222000CE"].last_price;

    vi.mocked(market.getHistoricalCandles).mockResolvedValue([]);

    const coverage = await enrichReplaySessionWithRealPrices("NIFTY", allTicks, instruments, "2026-07-21", "1");

    expect(coverage).toEqual({ attempted: 1, matched: 0 });
    expect(allTicks[0]["NSE:NIFTY99DEC2222000CE"]).toMatchObject({
      last_price: syntheticPrice,
      source: "synthetic",
    });
  });

  it("keeps the synthetic price when the broker fetch throws", async () => {
    const candles = [makeCandle({ close: 22000 })];
    const instruments = [instrument("NSE:NIFTY99DEC2222000CE", 22000)];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);
    const syntheticPrice = allTicks[0]["NSE:NIFTY99DEC2222000CE"].last_price;

    vi.mocked(market.getHistoricalCandles).mockRejectedValue(new Error("no data for symbol"));

    const coverage = await enrichReplaySessionWithRealPrices("NIFTY", allTicks, instruments, "2026-07-21", "1");

    expect(coverage).toEqual({ attempted: 1, matched: 0 });
    expect(allTicks[0]["NSE:NIFTY99DEC2222000CE"].last_price).toBe(syntheticPrice);
  });

  it("only attempts contracts within the strike window of the nearest expiry", async () => {
    // 30 strikes 500pts apart, ATM sitting in the middle of the range so the
    // ±10-strike window isn't clipped by a range edge, plus one far-later
    // expiry contract that should never be fetched.
    const atmIndex = 15;
    const atmStrike = 20000 + atmIndex * 500;
    const candles = [makeCandle({ close: atmStrike })];
    const farExpiryLater = "31-Dec-2100";
    const nearExpiryStrikes: Instrument[] = Array.from({ length: 30 }, (_, i) =>
      instrument(`NSE:STRIKE_${20000 + i * 500}_CE`, 20000 + i * 500)
    );
    const instruments = [
      ...nearExpiryStrikes,
      { ...instrument("NSE:OTHER_EXPIRY_CE", atmStrike), expiry: farExpiryLater },
    ];
    const { allTicks } = buildReplaySession("NIFTY", candles, instruments, 0.15);

    vi.mocked(market.getHistoricalCandles).mockResolvedValue([]);

    const coverage = await enrichReplaySessionWithRealPrices("NIFTY", allTicks, instruments, "2026-07-21", "1");

    // Only the 21-strike window (±10 around ATM) on the nearest expiry should
    // be fetched — not the far-later-expiry contract, and not every strike.
    expect(coverage.attempted).toBe(21);
    expect(market.getHistoricalCandles).not.toHaveBeenCalledWith(
      "NSE:OTHER_EXPIRY_CE", "2026-07-21", "2026-07-21", "1"
    );
  });
});
