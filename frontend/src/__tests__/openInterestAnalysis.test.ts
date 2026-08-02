import { describe, expect, it } from "vitest";
import { analyzeOpenInterest } from "@/lib/openInterestAnalysis";
import type { Instrument } from "@/types/market";

function option(strike: number, optionType: "CE" | "PE", oi: number, oiChange: number): Instrument {
  return {
    trading_symbol: `NSE:TEST${strike}${optionType}`,
    symbol: "TEST",
    instrument_type: "OPTIDX",
    expiry: "28-Aug-2026",
    strike,
    option_type: optionType,
    exchange: "NFO",
    oi,
    oi_change: oiChange,
  };
}

describe("open-interest analysis", () => {
  it("derives support and resistance from the relevant side of spot", () => {
    const analysis = analyzeOpenInterest([
      option(22000, "PE", 150, 30), option(22000, "CE", 90, 10),
      option(22100, "PE", 400, 50), option(22100, "CE", 300, 20),
      option(22200, "PE", 100, 5), option(22200, "CE", 800, 120),
    ], 22150);

    expect(analysis.support).toMatchObject({ strike: 22100, openInterest: 400, sessionChange: 50 });
    expect(analysis.resistance).toMatchObject({ strike: 22200, openInterest: 800, sessionChange: 120 });
    expect(analysis.putCallRatio).toBeCloseTo(650 / 1190);
    expect(analysis.totalCallOi).toBe(1190);
    expect(analysis.totalPutOi).toBe(650);
    expect(analysis.totalCallChange).toBe(150);
    expect(analysis.totalPutChange).toBe(85);
  });

  it("finds the largest positive OI additions and a max-pain reference", () => {
    const analysis = analyzeOpenInterest([
      option(22000, "PE", 120, 70), option(22000, "CE", 100, -10),
      option(22100, "PE", 200, 10), option(22100, "CE", 300, 90),
      option(22200, "PE", 80, -5), option(22200, "CE", 180, 15),
    ], 22100);

    expect(analysis.strongestPutAddition).toMatchObject({ strike: 22000, sessionChange: 70 });
    expect(analysis.strongestCallAddition).toMatchObject({ strike: 22100, sessionChange: 90 });
    expect(analysis.maxPain).toBe(22100);
  });

  it("aggregates positive and negative session OI changes across the expiry", () => {
    const analysis = analyzeOpenInterest([
      option(22000, "CE", 100, 25), option(22000, "PE", 200, -15),
      option(22100, "CE", 300, -50), option(22100, "PE", 400, 40),
    ], 22100);

    expect(analysis.totalCallChange).toBe(-25);
    expect(analysis.totalPutChange).toBe(25);
  });
});
