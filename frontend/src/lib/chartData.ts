import type { OHLCVData } from "@/lib/indicators";

type TimePoint = { time: string | number };

function toUnixSeconds(time: TimePoint["time"]): number | null {
  const timestamp = typeof time === "string" ? Date.parse(time) / 1000 : time;
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Lightweight Charts rejects data that is not strictly ascending by time.
 * Broker/history responses can contain overlapping pages or arrive out of
 * order, so normalize every series at the chart boundary.
 */
export function sortAndDeduplicateChartData<T extends TimePoint>(
  points: T[]
): Array<T & { time: number }> {
  const pointsByTime = new Map<number, T>();
  for (const point of points) {
    const time = toUnixSeconds(point.time);
    if (time !== null) pointsByTime.set(time, point);
  }

  return Array.from(pointsByTime, ([time, point]) => ({ ...point, time }))
    .sort((left, right) => left.time - right.time);
}

export function normalizeOHLCVData(data: OHLCVData[]): OHLCVData[] {
  return sortAndDeduplicateChartData(data);
}
