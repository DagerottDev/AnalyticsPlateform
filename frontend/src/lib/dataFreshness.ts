import type { MarketTick } from "@/types/market";
import { getNseMarketSession } from "@/lib/marketSession";

export type FreshnessState = "waiting" | "live" | "delayed" | "stale" | "closed";

export interface DataFreshness {
  state: FreshnessState;
  label: string;
  detail: string;
}

/**
 * Turn broker timestamps (which can be seconds or milliseconds) into a
 * compact, consistent status for market-data views. A future timestamp is
 * treated as fresh: a broker clock drifting slightly ahead must not make a
 * valid quote look stale.
 */
export function describeDataFreshness(
  tick: Pick<MarketTick, "timestamp"> | null | undefined,
  nowMs: number = Date.now()
): DataFreshness {
  const marketSession = getNseMarketSession(new Date(nowMs));
  if (marketSession.state !== "open") {
    return { state: "closed", label: marketSession.label, detail: marketSession.detail };
  }
  if (!tick?.timestamp || !Number.isFinite(tick.timestamp)) {
    return { state: "waiting", label: "Awaiting quote", detail: "No market-data timestamp received yet." };
  }

  const timestampMs = tick.timestamp < 100_000_000_000 ? tick.timestamp * 1000 : tick.timestamp;
  const ageSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  const ageLabel = ageSeconds < 60 ? `${ageSeconds}s ago` : `${Math.floor(ageSeconds / 60)}m ago`;

  if (ageSeconds <= 15) {
    return { state: "live", label: `Live · ${ageLabel}`, detail: "Latest broker quote." };
  }
  if (ageSeconds <= 60) {
    return { state: "delayed", label: `Delayed · ${ageLabel}`, detail: "Showing the latest quote while the live feed catches up." };
  }
  return { state: "stale", label: `Stale · ${ageLabel}`, detail: "Showing the last received quote. Refresh or reconnect the broker feed." };
}
