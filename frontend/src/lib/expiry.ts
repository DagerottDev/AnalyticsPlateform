const MONTHS = new Map([
  ["JAN", 0],
  ["FEB", 1],
  ["MAR", 2],
  ["APR", 3],
  ["MAY", 4],
  ["JUN", 5],
  ["JUL", 6],
  ["AUG", 7],
  ["SEP", 8],
  ["OCT", 9],
  ["NOV", 10],
  ["DEC", 11],
]);

function expiryTimestamp(value: string): number | null {
  const labelMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (labelMatch) {
    const [, day, month, year] = labelMatch;
    const monthIndex = MONTHS.get(month.toUpperCase());
    if (monthIndex !== undefined) return Date.UTC(Number(year), monthIndex, Number(day));
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Return expiry labels in chronological order without mutating the input. */
export function sortExpiries(expiries: readonly string[]): string[] {
  return Array.from(new Set(expiries.filter(Boolean))).sort((left, right) => {
    const leftTimestamp = expiryTimestamp(left);
    const rightTimestamp = expiryTimestamp(right);
    if (leftTimestamp === null && rightTimestamp === null) return left.localeCompare(right);
    if (leftTimestamp === null) return 1;
    if (rightTimestamp === null) return -1;
    return leftTimestamp - rightTimestamp || left.localeCompare(right);
  });
}

/** Return the furthest-dated available expiry, or null when none are valid. */
export function latestExpiry(expiries: readonly string[]): string | null {
  const sorted = sortExpiries(expiries);
  return sorted.length > 0 && expiryTimestamp(sorted[sorted.length - 1]) !== null
    ? sorted[sorted.length - 1]
    : null;
}
