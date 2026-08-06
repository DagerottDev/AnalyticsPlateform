import type { MarketTick } from "@/types/market";
import { getNseMarketSession, type MarketSegment } from "@/lib/marketSession";

export type FreshnessState = "waiting" | "live" | "delayed" | "stale" | "closed";

export interface DataFreshness {
  state: FreshnessState;
  label: string;
  detail: string;
}

const LIVE_TICK_MAX_AGE_SECONDS = 15;
const DELAYED_TICK_MAX_AGE_SECONDS = 60;

/** Normalize broker timestamps (seconds or milliseconds) to milliseconds. */
export function tickTimestampMs(
  tick: Pick<MarketTick, "timestamp"> | null | undefined,
): number | null {
  if (!tick?.timestamp || !Number.isFinite(tick.timestamp)) return null;
  return tick.timestamp < 100_000_000_000 ? tick.timestamp * 1000 : tick.timestamp;
}

/** Age of a broker quote, clamped at zero for a slightly-ahead broker clock. */
export function tickAgeSeconds(
  tick: Pick<MarketTick, "timestamp"> | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const timestampMs = tickTimestampMs(tick);
  if (timestampMs === null) return null;
  return Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
}

/**
 * A recent websocket tick is stronger evidence than our calendar. Fyers can
 * keep streaming during extended/exception sessions, so callers should not
 * discard this tick just because the browser's regular-session schedule has
 * already elapsed.
 */
export function isFreshBrokerStreamTick(
  tick: Pick<MarketTick, "timestamp" | "feed" | "last_stream_timestamp"> | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!tick || (tick.feed !== "stream" && tick.last_stream_timestamp == null)) return false;
  const streamTimestamp = tick.last_stream_timestamp ?? tick.timestamp;
  const ageSeconds = tickAgeSeconds({ timestamp: streamTimestamp }, nowMs);
  return ageSeconds != null && ageSeconds <= LIVE_TICK_MAX_AGE_SECONDS;
}

/**
 * Turn broker timestamps (which can be seconds or milliseconds) into a
 * compact, consistent status for market-data views. A future timestamp is
 * treated as fresh: a broker clock drifting slightly ahead must not make a
 * valid quote look stale.
 */
export function describeDataFreshness(
  tick: Pick<MarketTick, "timestamp" | "feed" | "last_stream_timestamp"> | null | undefined,
  nowMs: number = Date.now(),
  segment: MarketSegment = "fno"
): DataFreshness {
  const marketSession = getNseMarketSession(new Date(nowMs), segment);
  const ageSeconds = tickAgeSeconds(tick, nowMs);
  const ageLabel = ageSeconds == null
    ? null
    : ageSeconds < 60 ? `${ageSeconds}s ago` : `${Math.floor(ageSeconds / 60)}m ago`;
  const streamAgeSeconds = tick && (tick.feed === "stream" || tick.last_stream_timestamp != null)
    ? tickAgeSeconds({ timestamp: tick.last_stream_timestamp ?? tick.timestamp }, nowMs)
    : null;
  const streamAgeLabel = streamAgeSeconds == null
    ? null
    : streamAgeSeconds < 60 ? `${streamAgeSeconds}s ago` : `${Math.floor(streamAgeSeconds / 60)}m ago`;

  // A fresh stream tick is broker evidence that wins over a stale local
  // session calendar (extended hours, special sessions, or a clock skew).
  // REST snapshots deliberately do not take this path: they are still shown
  // as closed outside regular hours, rather than pretending the market is
  // trading merely because the quotes endpoint answered.
  if (streamAgeSeconds != null && streamAgeSeconds <= DELAYED_TICK_MAX_AGE_SECONDS) {
    if (streamAgeSeconds <= LIVE_TICK_MAX_AGE_SECONDS) {
      return { state: "live", label: "Live", detail: `Latest broker stream tick (${streamAgeLabel}).` };
    }
    return { state: "delayed", label: `Delayed · ${streamAgeLabel}`, detail: "A broker stream tick arrived recently; waiting for the next update." };
  }

  if (marketSession.state !== "open") {
    return { state: "closed", label: marketSession.label, detail: marketSession.detail };
  }
  if (ageSeconds == null) {
    return { state: "waiting", label: "Awaiting quote", detail: "No market-data timestamp received yet." };
  }

  if (ageSeconds <= 15) {
    return { state: "live", label: "Live", detail: `Latest broker quote (${ageLabel}).` };
  }
  if (ageSeconds <= 60) {
    return { state: "delayed", label: `Delayed · ${ageLabel}`, detail: "Showing the latest quote while the live feed catches up." };
  }
  return { state: "stale", label: `Stale · ${ageLabel}`, detail: "Showing the last received quote. Refresh or reconnect the broker feed." };
}
