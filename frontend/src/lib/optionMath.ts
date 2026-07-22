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
 * (15:30 local) and floors at a small positive value so downstream
 * Black-Scholes math never divides by / multiplies a zero T.
 */
export function timeToExpiry(expiry: string | null | undefined, atMs: number = Date.now()): number {
  if (!expiry) return 0.0001;
  const expDate = new Date(expiry);
  expDate.setHours(15, 30, 0, 0);
  const diffDays = (expDate.getTime() - atMs) / (1000 * 60 * 60 * 24);
  return Math.max(diffDays / 365, 0.0001);
}

/** The strike in `strikes` closest to `target` (e.g. the current spot price). */
export function nearestStrikeTo(strikes: number[], target: number): number {
  if (strikes.length === 0) return target;
  return strikes.reduce((closest, s) => (Math.abs(s - target) < Math.abs(closest - target) ? s : closest));
}

/** Fallback spot price used before a live tick has arrived for a symbol. */
export function defaultSpotFallback(symbol: string): number {
  return symbol === "NIFTY" ? 22000 : 48000;
}

/** Risk-free rate used across payoff/Greeks/IV calculations for Indian markets. */
export const DEFAULT_RISK_FREE_RATE = 0.10;
