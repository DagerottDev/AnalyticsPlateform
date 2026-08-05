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
  const expDate = new Date(expiry);
  if (!Number.isFinite(expDate.getTime())) return 0.0001;
  const year = expDate.getUTCFullYear();
  const month = expDate.getUTCMonth();
  const day = expDate.getUTCDate();
  const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const closeMinute = dateKey >= "2026-08-03" ? 40 : 30;
  // 15:xx IST is UTC+05:30. Date.UTC keeps this deterministic regardless of
  // the browser's own timezone and makes historical replay use old hours.
  const expiryCloseMs = Date.UTC(year, month, day, 10, closeMinute, 0, 0);
  const diffDays = (expiryCloseMs - atMs) / (1000 * 60 * 60 * 24);
  return Math.max(diffDays / 365, 0.0001);
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
