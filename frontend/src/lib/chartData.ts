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

/**
 * Apply the latest live price to the newest historical bar before calculating
 * indicators. The chart intentionally keeps the historical bar timestamp so
 * the live quote updates the in-progress candle rather than creating a
 * duplicate point at millisecond tick precision.
 */
export function mergeLiveCandle(
  data: OHLCVData[],
  liveTick: { price: number; timestamp: number } | null | undefined,
): OHLCVData[] {
  const normalized = normalizeOHLCVData(data);
  if (
    normalized.length === 0
    || !liveTick
    || !Number.isFinite(liveTick.price)
    || liveTick.price <= 0
  ) {
    return normalized;
  }

  const lastIndex = normalized.length - 1;
  const last = normalized[lastIndex];
  const price = liveTick.price;
  return [
    ...normalized.slice(0, lastIndex),
    {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    },
  ];
}
