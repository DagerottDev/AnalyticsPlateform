import { TickMarkType, type BusinessDay, type TickMarkFormatter, type Time, type TimeFormatterFn } from "lightweight-charts";

export const MARKET_TIME_ZONE = "Asia/Kolkata";

function isBusinessDay(time: Time): time is BusinessDay {
  return typeof time === "object" && time !== null;
}

export function timeToDate(time: Time): Date | null {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") {
    const milliseconds = Date.parse(time);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  }
  if (isBusinessDay(time)) return new Date(Date.UTC(time.year, time.month - 1, time.day));
  return null;
}

function format(time: Time, options: Intl.DateTimeFormatOptions): string {
  const date = timeToDate(time);
  return date ? new Intl.DateTimeFormat("en-IN", { timeZone: MARKET_TIME_ZONE, hour12: false, ...options }).format(date) : "";
}

/** Full IST timestamp for the crosshair, data table, and screen-reader text. */
export const formatMarketDateTime: TimeFormatterFn<Time> = (time) => format(time, {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Compact IST time-scale labels; dates are used for major scale breaks. */
export const formatMarketTick: TickMarkFormatter = (time, tickMarkType) => {
  if (tickMarkType === TickMarkType.Year) return format(time, { year: "numeric" });
  if (tickMarkType === TickMarkType.Month) return format(time, { month: "short" });
  if (tickMarkType === TickMarkType.DayOfMonth) return format(time, { day: "2-digit", month: "short" });
  return format(time, { hour: "2-digit", minute: "2-digit" });
};

export const MARKET_CHART_LOCALIZATION = {
  locale: "en-IN",
  timeFormatter: formatMarketDateTime,
};
