import { describe, it, expect } from "vitest";
import { normalizeTick } from "../lib/websocket";

describe("normalizeTick", () => {
  it("normalizes an already-quote-shaped message (from the REST quotes poller)", () => {
    const tick = normalizeTick({
      trading_symbol: "NIFTY",
      last_price: 22050.5,
      volume: 1000,
      open_interest: 0,
      change: 12.3,
      change_percent: 0.06,
      timestamp: 1721800000,
    });

    expect(tick).toEqual({
      trading_symbol: "NIFTY",
      last_price: 22050.5,
      volume: 1000,
      open_interest: 0,
      timestamp: 1721800000000, // seconds -> ms
      change: 12.3,
      change_percent: 0.06,
      feed: "snapshot",
    });
  });

  it("normalizes a raw live Fyers websocket tick, defaulting missing fields", () => {
    const tick = normalizeTick({ symbol: "NSE:NIFTY50-INDEX", ltp: 22100 });

    expect(tick?.trading_symbol).toBe("NSE:NIFTY50-INDEX");
    expect(tick?.last_price).toBe(22100);
    expect(tick?.volume).toBe(0);
    expect(tick?.open_interest).toBe(0);
    expect(tick?.change).toBe(0);
    expect(tick?.change_percent).toBe(0);
    expect(tick?.feed).toBe("stream");
    expect(tick?.last_stream_timestamp).toBe(tick?.timestamp);
  });

  it("carries through volume/change fields on a raw live tick when present", () => {
    const tick = normalizeTick({
      symbol: "NSE:NIFTY50-INDEX",
      ltp: 22100,
      vol_traded_today: 5000,
      ch: 15.2,
      chp: 0.07,
    });

    expect(tick?.volume).toBe(5000);
    expect(tick?.change).toBe(15.2);
    expect(tick?.change_percent).toBe(0.07);
  });

  it("returns null for a message matching neither shape", () => {
    expect(normalizeTick({})).toBeNull();
    expect(normalizeTick({ symbol: "NIFTY" })).toBeNull(); // no ltp
    expect(normalizeTick({ ltp: 100 })).toBeNull(); // no symbol
  });
});
