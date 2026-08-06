import { describe, expect, it } from "vitest";
import { mergeMarketTick, quoteLastPrice, toClosedMarketQuote } from "@/lib/marketTick";
import type { MarketTick } from "@/types/market";

const snapshot: MarketTick = {
  trading_symbol: "BANKNIFTY",
  last_price: 57449.2,
  volume: 123456,
  open_interest: 0,
  timestamp: 1_000,
  change: -798.75,
  change_percent: -1.37,
  open_price: 58200,
  high_price: 58600,
  low_price: 57100,
  prev_close_price: 58247.95,
};

describe("mergeMarketTick", () => {
  it("keeps REST OHLC and volume when a stream tick omits them", () => {
    const merged = mergeMarketTick(snapshot, {
      ...snapshot,
      last_price: 57450,
      timestamp: 2_000,
      volume: 0,
      open_price: undefined,
      high_price: undefined,
      low_price: undefined,
      prev_close_price: undefined,
    });

    expect(merged).toMatchObject({
      last_price: 57450,
      volume: 123456,
      open_price: 58200,
      high_price: 58600,
      low_price: 57100,
      prev_close_price: 58247.95,
    });
  });

  it("retains the latest stream provenance when a REST snapshot arrives later", () => {
    const streamTimestamp = 10_000;
    const streamed = mergeMarketTick(snapshot, {
      ...snapshot,
      timestamp: streamTimestamp,
      feed: "stream",
      last_stream_timestamp: streamTimestamp,
    });
    const merged = mergeMarketTick(streamed, {
      ...snapshot,
      timestamp: streamTimestamp + 3_000,
      feed: "snapshot",
    });

    expect(merged.last_stream_timestamp).toBe(streamTimestamp);
  });
});

describe("toClosedMarketQuote", () => {
  it("keeps the broker last traded price for after-hours analytics", () => {
    const quote = toClosedMarketQuote(snapshot);

    expect(quote.last_price).toBe(snapshot.last_price);
    expect(quote.change).toBe(0);
    expect(quote.change_percent).toBe(0);
  });

  it("falls back to previous close only when last price is unavailable", () => {
    expect(quoteLastPrice({ last_price: 0, prev_close_price: 58247.95 })).toBe(58247.95);
    expect(toClosedMarketQuote({ ...snapshot, last_price: 0 }).last_price).toBe(58247.95);
  });
});
