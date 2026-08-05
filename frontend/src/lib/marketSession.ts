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
