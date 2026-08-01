export type NseMarketSessionState = "preopen" | "open" | "closed";

export interface NseMarketSession {
  state: NseMarketSessionState;
  label: string;
  detail: string;
}

const MARKET_TIME_ZONE = "Asia/Kolkata";
const REGULAR_OPEN_MINUTES = 9 * 60 + 15;
const REGULAR_CLOSE_MINUTES = 15 * 60 + 30;
const PREOPEN_MINUTES = 9 * 60;

function istParts(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return { weekday: value("weekday"), hour: Number(value("hour")), minute: Number(value("minute")) };
}

/** NSE equity-derivatives regular session. Exchange-declared holidays and
 * exceptional sessions are intentionally treated as an external schedule. */
export function getNseMarketSession(now: Date = new Date()): NseMarketSession {
  const { weekday, hour, minute } = istParts(now);
  if (weekday === "Sat" || weekday === "Sun") {
    return { state: "closed", label: "Market closed", detail: "Indian equity-derivatives trading is closed on weekends." };
  }
  const minutes = hour * 60 + minute;
  if (minutes >= REGULAR_OPEN_MINUTES && minutes < REGULAR_CLOSE_MINUTES) {
    return { state: "open", label: "Market open", detail: "Indian equity-derivatives session: 09:15–15:30 IST." };
  }
  if (minutes >= PREOPEN_MINUTES && minutes < REGULAR_OPEN_MINUTES) {
    return { state: "preopen", label: "Pre-open", detail: "Pre-open runs before the 09:15 IST regular session; live quote subscriptions stay paused." };
  }
  return { state: "closed", label: "Market closed", detail: "Outside the Indian equity-derivatives session (09:15–15:30 IST)." };
}

export function isNseRegularMarketOpen(now: Date = new Date()): boolean {
  return getNseMarketSession(now).state === "open";
}
