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

  it("does not let a slow, older REST snapshot regress a newer stream price", () => {
    // The backend multiplexes a live stream push and an independent ~3s
    // REST quote-poll fallback onto the same listener (see
    // FyersMarketStreamManager._quote_poll_loop). A REST call that started
    // *before* a stream tick can still resolve and arrive *after* it — its
    // own "as of" timestamp is older even though it lands later in wall time.
    const streamed = mergeMarketTick(snapshot, {
      ...snapshot,
      last_price: 57500,
      change: -698.75,
      change_percent: -1.2,
      timestamp: 5_000,
      feed: "stream",
    });
    expect(streamed.last_price).toBe(57500);

    // A REST snapshot quoted as-of an earlier moment (timestamp 4_200)
    // arrives after the stream tick above (timestamp 5_000).
    const merged = mergeMarketTick(streamed, {
      ...snapshot,
      last_price: 57100,
      change: -1098.75,
      change_percent: -1.9,
      timestamp: 4_200,
      feed: "snapshot",
    });

    expect(merged.last_price).toBe(57500);
    expect(merged.change).toBe(-698.75);
    expect(merged.change_percent).toBe(-1.2);
    expect(merged.timestamp).toBe(5_000);
  });

  it("still applies a genuinely newer snapshot even without a stream feed", () => {
    const merged = mergeMarketTick(snapshot, {
      ...snapshot,
      last_price: 57600,
      timestamp: snapshot.timestamp + 500,
      feed: "snapshot",
    });

    expect(merged.last_price).toBe(57600);
    expect(merged.timestamp).toBe(snapshot.timestamp + 500);
  });

  it("treats seconds- and milliseconds-scale timestamps consistently when comparing staleness", () => {
    // Stream/REST timestamps are not guaranteed to share units — a stale
    // check that compared raw values without normalizing would misjudge
    // ordering whenever one side is in seconds and the other in ms.
    const streamed = mergeMarketTick(snapshot, {
      ...snapshot,
      last_price: 57500,
      timestamp: 1_700_000_050, // seconds
      feed: "stream",
    });
    const merged = mergeMarketTick(streamed, {
      ...snapshot,
      last_price: 57100,
      timestamp: 1_700_000_040_000, // ms, but earlier than the stream tick above
      feed: "snapshot",
    });

    expect(merged.last_price).toBe(57500);
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
