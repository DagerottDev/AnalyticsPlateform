import type { OpenInterestSnapshot } from "@/lib/market";

export const OI_SNAPSHOT_INTERVAL_MS = 30_000;

function bucket(timestamp: string): number | null {
  const milliseconds = new Date(timestamp).getTime();
  return Number.isFinite(milliseconds)
    ? milliseconds - (milliseconds % OI_SNAPSHOT_INTERVAL_MS)
    : null;
}

/** Sort and keep the latest observation in every server snapshot bucket. */
export function mergeOpenInterestSnapshots(
  history: OpenInterestSnapshot[],
  latest: OpenInterestSnapshot | null = null
): OpenInterestSnapshot[] {
  const byBucket = new Map<number, OpenInterestSnapshot>();
  for (const point of [...history, ...(latest ? [latest] : [])]) {
    const key = bucket(point.timestamp);
    if (key !== null) byBucket.set(key, point);
  }
  return Array.from(byBucket.entries(), ([timestamp, point]) => ({
    ...point,
    timestamp: new Date(timestamp).toISOString(),
  })).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function hasFullSessionHistory(points: OpenInterestSnapshot[]): boolean {
  if (points.length === 0) return false;
  const first = new Date(points[0].timestamp);
  if (!Number.isFinite(first.getTime())) return false;
  const opening = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(first);
  const value = (type: string) => Number(opening.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute") <= 9 * 60 + 16;
}
