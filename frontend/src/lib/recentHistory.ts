import { MARKET_TIME_ZONE } from "./chartTime";

const REGULAR_OPEN_MINUTES = 9 * 60 + 15;

interface IstDateParts {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
}

function istDateParts(now: Date): IstDateParts {
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
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function previousWeekday(date: Date): Date {
  const previous = new Date(date);
  do {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } while (previous.getUTCDay() === 0 || previous.getUTCDay() === 6);
  return previous;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Return a one-session history range in the exchange's timezone. During a
 * regular session (or after the close), use today so the chart includes the
 * newest candles. On weekends and before the regular open, use the previous
 * weekday so a closed market still shows the latest available session.
 * Exchange holidays remain broker-owned; the caller can report no data when
 * the broker has no candles for the selected weekday.
 */
export function recentMarketDateRange(now: Date = new Date()): { from: string; to: string } {
  const parts = istDateParts(now);
  let marketDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  if (isWeekend || parts.minutes < REGULAR_OPEN_MINUTES) {
    marketDate = previousWeekday(marketDate);
  }
  const key = dateKey(marketDate);
  return { from: key, to: key };
}
