import { describe, expect, it } from "vitest";
import {
  formatIstDatetimeLocal,
  getNseMarketSession,
  isFnoSymbol,
  parseIstDatetimeLocal,
} from "@/lib/marketSession";

describe("NSE market session", () => {
  it("opens at 09:15 IST and uses the pre-CAS F&O close before 03-Aug-2026", () => {
    expect(getNseMarketSession(new Date("2026-07-31T03:44:00Z")).state).toBe("preopen");
    expect(getNseMarketSession(new Date("2026-07-31T03:45:00Z")).state).toBe("open");
    expect(getNseMarketSession(new Date("2026-07-31T10:00:00Z")).state).toBe("closed");
  });

  it("keeps F&O open through 15:40 after CAS timing while cash closes at 15:30", () => {
    const at1535 = new Date("2026-08-03T10:05:00Z"); // 15:35 IST
    expect(getNseMarketSession(at1535, "fno").state).toBe("open");
    expect(getNseMarketSession(at1535, "cash").state).toBe("closed");
    expect(getNseMarketSession(new Date("2026-08-03T10:10:00Z"), "fno").state).toBe("closed");
  });

  it("does not treat 15:15 IST as the F&O close", () => {
    expect(getNseMarketSession(new Date("2026-08-05T09:45:00Z"), "fno").state).toBe("open");
  });

  it("classifies explicit cash symbols separately from F&O references", () => {
    expect(isFnoSymbol("NFO:NIFTY26AUG22000CE")).toBe(true);
    expect(isFnoSymbol("NSE_FNO:12345")).toBe(true);
    expect(isFnoSymbol("NSE:SBIN-EQ")).toBe(false);
  });

  it("is closed on a Friday evening and weekends", () => {
    expect(getNseMarketSession(new Date("2026-07-31T18:21:00Z")).state).toBe("closed");
    expect(getNseMarketSession(new Date("2026-08-01T04:00:00Z")).state).toBe("closed");
  });
});

describe("IST datetime-local helpers", () => {
  // Regression coverage for a UX bug: a native <input type="datetime-local">
  // always operates in the browser's own timezone, but the GTT expiry field
  // is labeled "IST" — these two functions are the read/write boundary that
  // keeps the field's value string meaning IST wall-clock time regardless of
  // where the browser actually is.

  it("formatIstDatetimeLocal renders IST wall-clock digits, not UTC or browser-local", () => {
    // 2026-08-06T09:15:00Z is 14:45 IST (UTC+5:30) the same calendar day.
    expect(formatIstDatetimeLocal(new Date("2026-08-06T09:15:00Z"))).toBe("2026-08-06T14:45");
    // 2026-08-06T20:00:00Z is 01:30 IST the *next* calendar day — exercises
    // the date-rollover case, not just a same-day offset.
    expect(formatIstDatetimeLocal(new Date("2026-08-06T20:00:00Z"))).toBe("2026-08-07T01:30");
  });

  it("parseIstDatetimeLocal interprets the digits as IST regardless of the runtime's own timezone", () => {
    const parsed = parseIstDatetimeLocal("2026-08-06T14:45");
    expect(parsed.toISOString()).toBe("2026-08-06T09:15:00.000Z");
  });

  it("format and parse round-trip to the same instant", () => {
    const original = new Date("2026-12-31T18:30:00Z");
    const roundTripped = parseIstDatetimeLocal(formatIstDatetimeLocal(original));
    expect(roundTripped.getTime()).toBe(original.getTime());
  });

  it("parseIstDatetimeLocal returns an invalid date for an empty string", () => {
    expect(Number.isNaN(parseIstDatetimeLocal("").getTime())).toBe(true);
  });
});
