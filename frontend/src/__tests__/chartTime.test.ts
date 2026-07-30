import { describe, expect, it } from "vitest";
import { TickMarkType, type Time } from "lightweight-charts";
import { formatMarketDateTime, formatMarketTick } from "@/lib/chartTime";

describe("market chart time formatting", () => {
  const marketOpenUtc = (Date.parse("2026-07-30T03:45:00Z") / 1000) as Time;

  it("formats a UTC market candle as IST", () => {
    expect(formatMarketDateTime(marketOpenUtc)).toContain("09:15");
  });

  it("keeps intraday axis labels in IST", () => {
    expect(formatMarketTick(marketOpenUtc, TickMarkType.Time, "en-IN")).toBe("09:15");
  });
});
