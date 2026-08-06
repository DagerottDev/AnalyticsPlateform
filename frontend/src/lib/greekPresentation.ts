import type { GreekMetric, GreekPoint } from "@/lib/strikeGreekAnalysis";

export type GreekDisplayMode = "native" | "change" | "standardized";

/** Default view for every Greek panel: put unlike-scaled Greeks on a common z-score scale. */
export const DEFAULT_GREEK_DISPLAY_MODE: GreekDisplayMode = "standardized";

export const GREEK_UNITS: Record<GreekMetric, string> = {
  delta: "premium points / ₹1 spot",
  gamma: "Δ delta / ₹1 spot",
  theta: "premium points / calendar day",
  vega: "premium points / 1 IV point",
  rho: "premium points / 1 rate point",
  vanna: "Δ delta / 1 IV point",
  vomma: "Δ vega / 1 IV point",
  charm: "Δ delta / calendar day",
  speed: "Δ gamma / ₹1 spot",
  color: "Δ gamma / calendar day",
  zomma: "Δ gamma / 1 IV point",
  ultima: "Δ vomma / 1 IV point",
};

export function formatGreekValue(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1_000_000)) return value.toExponential(2);
  if (magnitude < 0.01) return value.toFixed(5);
  if (magnitude < 1) return value.toFixed(4);
  return value.toFixed(2);
}

export function displayGreekPoints(points: GreekPoint[], mode: GreekDisplayMode): GreekPoint[] {
  if (mode === "native" || points.length === 0) return points;
  const base = points[0].value;
  if (mode === "change") return points.map((point) => ({ ...point, value: point.value - base }));
  const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const variance = points.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / points.length;
  const deviation = Math.sqrt(variance);
  return points.map((point) => ({ ...point, value: deviation > 1e-12 ? (point.value - mean) / deviation : 0 }));
}
