import { describe, expect, it } from "vitest";
import { normalizeOHLCVData, sortAndDeduplicateChartData } from "@/lib/chartData";

describe("chart data normalization", () => {
  it("sorts out-of-order history and keeps only the latest duplicate timestamp", () => {
    const data = normalizeOHLCVData([
      { time: 1785319140, open: 11, high: 12, low: 10, close: 11 },
      { time: 1785296700, open: 9, high: 10, low: 8, close: 9 },
      { time: 1785319140, open: 12, high: 13, low: 11, close: 12 },
    ]);

    expect(data.map((point) => point.time)).toEqual([1785296700, 1785319140]);
    expect(data.at(-1)?.close).toBe(12);
  });

  it("normalizes indicator-series timestamps before chart rendering", () => {
    const points = sortAndDeduplicateChartData([
      { time: "2026-07-29T10:00:00Z", value: 2 },
      { time: "2026-07-29T09:00:00Z", value: 1 },
    ]);

    expect(points[0].time).toBeLessThan(points[1].time);
  });
});
