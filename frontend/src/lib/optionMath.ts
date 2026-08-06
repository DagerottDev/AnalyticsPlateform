/**
 * Option-chain-adjacent utility math shared across pages/components that
 * price or analyze options from a live spot tick: time-to-expiry, nearest-
 * strike (ATM) lookup, and the default spot/risk-free-rate fallbacks used
 * before a live tick has arrived. Kept separate from lib/greeks.ts, which
 * stays scoped to the Black-Scholes pricing formulas themselves.
 */

/**
 * Time-to-expiry (years) for an option, from `expiry` (a parseable date
 * string, e.g. "25-Jul-2024") to `atMs` (defaults to now). Pegs to NSE close
 * (15:30 IST before CAS timing, 15:40 IST from 03-Aug-2026) and floors at a
 * small positive value so downstream
 * Black-Scholes math never divides by / multiplies a zero T.
 */
export function timeToExpiry(expiry: string | null | undefined, atMs: number = Date.now()): number {
  if (!expiry) return 0.0001;
  const expiryCloseMs = expiryCloseTimestamp(expiry);
  if (expiryCloseMs === null) return 0.0001;
  const diffDays = (expiryCloseMs - atMs) / (1000 * 60 * 60 * 24);
  return Math.max(diffDays / 365, 0.0001);
}

/** Exact IST F&O expiry close, sharing the CAS-aware market-session rule. */
export function expiryCloseTimestamp(expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  const expDate = new Date(expiry);
  if (!Number.isFinite(expDate.getTime())) return null;
  const year = expDate.getUTCFullYear();
  const month = expDate.getUTCMonth();
  const day = expDate.getUTCDate();
  const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return Date.UTC(year, month, day, 10, dateKey >= "2026-08-03" ? 40 : 30, 0, 0);
}

const EXPIRY_MONTHS = new Map([
  ["JAN", 0], ["FEB", 1], ["MAR", 2], ["APR", 3], ["MAY", 4], ["JUN", 5],
  ["JUL", 6], ["AUG", 7], ["SEP", 8], ["OCT", 9], ["NOV", 10], ["DEC", 11],
]);
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function expiryCalendarDay(expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  const value = expiry.trim();
  const labelMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (labelMatch) {
    const [, day, month, year] = labelMatch;
    const monthIndex = EXPIRY_MONTHS.get(month.toUpperCase());
    return monthIndex === undefined ? null : Date.UTC(Number(year), monthIndex, Number(day));
  }
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDateMatch) return Date.UTC(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]));
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
    : null;
}

/** Calendar days until expiry in the India market timezone, for display DTE. */
export function daysToExpiry(expiry: string | null | undefined, atMs: number = Date.now()): number {
  const expiryDay = expiryCalendarDay(expiry);
  if (expiryDay === null || !Number.isFinite(atMs)) return 0;
  const marketNow = new Date(atMs + IST_OFFSET_MS);
  const currentDay = Date.UTC(marketNow.getUTCFullYear(), marketNow.getUTCMonth(), marketNow.getUTCDate());
  return Math.max(0, Math.round((expiryDay - currentDay) / DAY_MS));
}

/** The strike in `strikes` closest to `target` (e.g. the current spot price). */
export function nearestStrikeTo(strikes: number[], target: number): number {
  if (strikes.length === 0) return target;
  return strikes.reduce((closest, s) => (Math.abs(s - target) < Math.abs(closest - target) ? s : closest));
}

/** Fallback spot price used before a live tick has arrived for a symbol. */
export function defaultSpotFallback(symbol: string): number {
  if (symbol === "NIFTY") return 22000;
  if (symbol === "SENSEX") return 80000;
  return 48000;
}

/** Risk-free rate used across payoff/Greeks/IV calculations for Indian markets. */
export const DEFAULT_RISK_FREE_RATE = 0.10;
