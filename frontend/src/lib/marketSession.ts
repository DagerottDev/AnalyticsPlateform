export type MarketSegment = "fno" | "cash";
export type NseMarketSessionState = "preopen" | "open" | "closed";

export interface NseMarketSession {
  state: NseMarketSessionState;
  label: string;
  detail: string;
}

const MARKET_TIME_ZONE = "Asia/Kolkata";
const REGULAR_OPEN_MINUTES = 9 * 60 + 15;
const CASH_CLOSE_MINUTES = 15 * 60 + 30;
const FNO_EXTENDED_CLOSE_MINUTES = 15 * 60 + 40;
const FNO_CAS_EFFECTIVE_DATE = "2026-08-03";

function istParts(now: Date): { date: string; weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function isFnoSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.startsWith("NSE:") && normalized.endsWith("-EQ")) return false;
  // The platform's bare UI symbols are selected from the F&O universe; all
  // option/future exchange references have an explicit derivatives prefix.
  return true;
}

export function fnoCloseMinutes(date: string): number {
  return date >= FNO_CAS_EFFECTIVE_DATE ? FNO_EXTENDED_CLOSE_MINUTES : CASH_CLOSE_MINUTES;
}

/** NSE regular-session state for a product segment; exceptional sessions stay broker-owned. */
export function getNseMarketSession(now: Date = new Date(), segment: MarketSegment = "fno"): NseMarketSession {
  const { date, weekday, hour, minute } = istParts(now);
  if (weekday === "Sat" || weekday === "Sun") {
    return { state: "closed", label: "Market closed", detail: "Indian markets are closed on weekends." };
  }
  const minutes = hour * 60 + minute;
  const close = segment === "fno" ? fnoCloseMinutes(date) : CASH_CLOSE_MINUTES;
  const sessionLabel = segment === "fno" && close === FNO_EXTENDED_CLOSE_MINUTES ? "09:15–15:40" : "09:15–15:30";
  const marketName = segment === "fno" ? "equity-derivatives" : "cash-equity";
  if (minutes >= REGULAR_OPEN_MINUTES && minutes < close) {
    return { state: "open", label: "Market open", detail: `Indian ${marketName} session: ${sessionLabel} IST.` };
  }
  if (minutes >= 9 * 60 && minutes < REGULAR_OPEN_MINUTES) {
    return { state: "preopen", label: "Pre-open", detail: "Pre-open runs before the 09:15 IST regular session; live quote subscriptions stay paused." };
  }
  return { state: "closed", label: "Market closed", detail: `Outside the Indian ${marketName} session (${sessionLabel} IST).` };
}

export function isNseRegularMarketOpen(now: Date = new Date(), segment: MarketSegment = "fno"): boolean {
  return getNseMarketSession(now, segment).state === "open";
}

// A native <input type="datetime-local"> always operates in the browser's
// own local timezone — there is no way to pin it to IST directly. Anywhere
// the UI labels such a field "IST" (e.g. a GTT expiry picker) must instead
// keep the field's value string meaning "these digits are IST wall-clock
// time" independent of the browser's zone, using these two helpers as the
// read/write boundary, so the label stays true for a trader outside IST too.
const IST_UTC_OFFSET = "+05:30";

/** Format a Date's IST wall-clock time as a datetime-local value string. */
export function formatIstDatetimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/** Parse a datetime-local value string as IST wall-clock time (not the
 * browser's local timezone) — the inverse of formatIstDatetimeLocal. */
export function parseIstDatetimeLocal(value: string): Date {
  return value ? new Date(`${value}:00${IST_UTC_OFFSET}`) : new Date(NaN);
}
