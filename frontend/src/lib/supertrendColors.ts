import type { SupertrendPoint } from "@/lib/indicators";

// Fixed canvas colors matching the platform's profit/loss tokens. Keep these
// hex values here because lightweight-charts cannot resolve CSS var() values.
export const SUPERTREND_UP_COLOR = "#2dd4a7";
export const SUPERTREND_DOWN_COLOR = "#ff6b7a";

export function supertrendColor(trend: SupertrendPoint["trend"]): string {
  return trend === "up" ? SUPERTREND_UP_COLOR : SUPERTREND_DOWN_COLOR;
}
