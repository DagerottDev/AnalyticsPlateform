import type { OpenInterestSnapshot } from "@/lib/market";

export interface OpenInterestChartPoint {
  /** Unix epoch seconds expected by lightweight-charts. */
  time: number;
  value: number;
}

/**
 * Normalize broker snapshots at the chart boundary. lightweight-charts
 * requires strictly ascending, unique timestamps; API tables can still show
 * rows that contain an invalid or repeated timestamp, so those rows must not
 * be passed directly to setData.
 */
export function normalizeOpenInterestSeries(
  points: OpenInterestSnapshot[],
  key: keyof OpenInterestSnapshot,
): OpenInterestChartPoint[] {
  const parsed = points
    .map((point, index) => ({
      timestamp: new Date(point.timestamp).getTime(),
      value: Number(point[key]),
      index,
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);

  const unique = new Map<number, number>();
  for (const point of parsed) {
    unique.set(Math.floor(point.timestamp / 1000), point.value);
  }

  return Array.from(unique, ([time, value]) => ({ time, value }));
}
