import type { IChartApi } from "lightweight-charts";

const ZOOM_RATIO = 0.7;

/** Zooms the visible horizontal range around its centre without changing data. */
export function zoomLightweightChart(chart: IChartApi | null, direction: "in" | "out"): void {
  if (!chart) return;
  const range = chart.timeScale().getVisibleLogicalRange();
  if (!range) return;
  const center = (range.from + range.to) / 2;
  const halfWidth = ((range.to - range.from) / 2) * (direction === "in" ? ZOOM_RATIO : 1 / ZOOM_RATIO);
  chart.timeScale().setVisibleLogicalRange({ from: center - halfWidth, to: center + halfWidth });
}
