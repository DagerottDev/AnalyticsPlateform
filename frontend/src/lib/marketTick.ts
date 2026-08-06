import type { MarketTick } from "@/types/market";
import { tickTimestampMs } from "@/lib/dataFreshness";

/**
 * Fyers' streaming update is intentionally small: it usually contains only
 * LTP/change/volume, while the REST seed contains the day's OHLC and previous
 * close. Preserve those snapshot fields when a later stream update omits them
 * so a live tick does not erase useful quote context from the UI.
 */
export function mergeMarketTick(previous: MarketTick | undefined, next: MarketTick): MarketTick {
  if (!previous) return next;

  // The shared backend multiplexes two independently-timed sources onto one
  // listener: live broker stream pushes, and a REST quote-poll fallback that
  // runs on its own ~3s timer regardless of stream health (see
  // FyersMarketStreamManager._quote_poll_loop). They can resolve out of
  // arrival order at the browser — a REST snapshot fetched *before* a stream
  // tick can still finish resolving *after* it. Trusting arrival order alone
  // (as this used to) lets a slow, market-stale snapshot overwrite
  // last_price/timestamp/change with older data — which flows straight into
  // order-ticket defaults (BuyTicketModal's limit-price prefill) and GTT/
  // stop-loss validity checks. Compare each tick's own "as of" timestamp
  // instead (normalized to ms — stream and REST can use different units,
  // see tickTimestampMs), and don't let an older tick overwrite anything a
  // newer one already established.
  const previousMs = tickTimestampMs(previous);
  const nextMs = tickTimestampMs(next);
  const nextIsStale = previousMs != null && nextMs != null && nextMs < previousMs;

  const merged: MarketTick = nextIsStale ? { ...previous } : { ...previous, ...next };

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
