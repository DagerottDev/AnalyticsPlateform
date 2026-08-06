import type { MarketTick } from "@/types/market";

/**
 * Fyers' streaming update is intentionally small: it usually contains only
 * LTP/change/volume, while the REST seed contains the day's OHLC and previous
 * close. Preserve those snapshot fields when a later stream update omits them
 * so a live tick does not erase useful quote context from the UI.
 */
export function mergeMarketTick(previous: MarketTick | undefined, next: MarketTick): MarketTick {
  if (!previous) return next;

  const merged: MarketTick = { ...previous, ...next };

  // The shared backend sends both raw websocket frames and REST fallback
  // snapshots through the same listener. Preserve the last stream timestamp
  // when a snapshot arrives after a stream tick, so extended-session liveness
  // is not lost merely because the fallback poll happened to run last.
  if (next.feed === "stream") {
    merged.last_stream_timestamp = next.last_stream_timestamp ?? next.timestamp;
  } else if (previous.last_stream_timestamp != null) {
    merged.last_stream_timestamp = previous.last_stream_timestamp;
  }
  const snapshotFields: Array<keyof Pick<MarketTick, "open_price" | "high_price" | "low_price" | "prev_close_price">> = [
    "open_price",
    "high_price",
    "low_price",
    "prev_close_price",
  ];

  for (const field of snapshotFields) {
    if (next[field] == null && previous[field] != null) merged[field] = previous[field];
  }

  // A sparse stream frame normalizes missing volume to 0. Keep the seeded
  // session volume in that case, but allow a genuine non-zero update through.
  if (next.volume === 0 && previous.volume > 0) merged.volume = previous.volume;
  if (next.open_interest === 0 && previous.open_interest > 0) merged.open_interest = previous.open_interest;

  return merged;
}

/** Return the broker's latest traded price, falling back only when it is absent. */
export function quoteLastPrice(
  quote: Pick<MarketTick, "last_price" | "prev_close_price"> | null | undefined,
): number | null {
  const candidates = [quote?.last_price, quote?.prev_close_price];
  const value = candidates.find((candidate): candidate is number => (
    typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
  ));
  return value ?? null;
}

/**
 * Normalize a broker snapshot for a closed-market view without replacing the
 * current last traded price with the prior session's close. `prev_close_price`
 * is only a fallback when the broker did not provide a usable last price.
 */
export function toClosedMarketQuote(quote: MarketTick): MarketTick {
  const lastPrice = quoteLastPrice(quote);
  if (lastPrice === null) {
    return quote;
  }
  return {
    ...quote,
    last_price: lastPrice,
    change: 0,
    change_percent: 0,
  };
}
