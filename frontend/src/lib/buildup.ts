export type BuildupCategory =
  | "Long Buildup"
  | "Short Buildup"
  | "Long Unwinding"
  | "Short Covering"
  | "Neutral";

export interface BuildupResult {
  category: BuildupCategory;
  shortLabel: string;
  tone: "profit" | "loss" | "blue" | "orange" | "neutral";
}

/** Below this, a leg is treated as flat rather than up/down — avoids
 * flip-flopping between categories on sub-noise moves. */
const FLAT_THRESHOLD_PERCENT = 0.05;

/**
 * Classifies OI direction + price direction into the standard four
 * buildup categories. Both inputs are percentage changes vs. the previous
 * trading day's close — the same baseline Fyers' `oichp` and a live tick's
 * `change_percent` each use — so pairing a ~30s-cached OI snapshot with a
 * live price tick is valid even though they refresh at different rates.
 */
export function classifyBuildup(
  priceChangePercent: number | null | undefined,
  oiChangePercent: number | null | undefined
): BuildupResult | null {
  if (priceChangePercent == null || oiChangePercent == null) return null;

  const priceUp = priceChangePercent > FLAT_THRESHOLD_PERCENT;
  const priceDown = priceChangePercent < -FLAT_THRESHOLD_PERCENT;
  const oiUp = oiChangePercent > FLAT_THRESHOLD_PERCENT;
  const oiDown = oiChangePercent < -FLAT_THRESHOLD_PERCENT;

  if (oiUp && priceUp) return { category: "Long Buildup", shortLabel: "LB", tone: "profit" };
  if (oiUp && priceDown) return { category: "Short Buildup", shortLabel: "SB", tone: "loss" };
  if (oiDown && priceDown) return { category: "Long Unwinding", shortLabel: "LU", tone: "orange" };
  if (oiDown && priceUp) return { category: "Short Covering", shortLabel: "SC", tone: "blue" };
  return { category: "Neutral", shortLabel: "-", tone: "neutral" };
}
