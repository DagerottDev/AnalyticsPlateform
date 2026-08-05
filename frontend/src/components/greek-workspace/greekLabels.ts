import type { AlertMetric } from "@/stores/alertStore";
import type { GreekMetric } from "@/lib/strikeGreekAnalysis";

/** Single source for Greek display labels — shared by the workspace page,
 * the metric selector, chart cards, and the alert modal so none of them
 * drift out of sync with each other. */
export const GREEK_LABEL: Record<GreekMetric, string> = {
  delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega", rho: "Rho",
  vanna: "Vanna", vomma: "Vomma", charm: "Charm", speed: "Speed", color: "Color", zomma: "Zomma", ultima: "Ultima",
};

/** Maps a chart's Greek metric to the alert system's metric vocabulary. */
export const METRIC_TO_ALERT: Record<GreekMetric, AlertMetric> = {
  delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega", rho: "Rho",
  vanna: "Vanna", vomma: "Vomma", charm: "Charm", speed: "Speed", color: "Color",
  zomma: "Zomma", ultima: "Ultima",
};
