import { describe, expect, it } from "vitest";
import type { RelativeValueInstrument } from "../lib/relativeValue";

describe("relative value comparison shape", () => {
  it("keeps IV and skew in decimal units so percentages remain comparable", () => {
    const row: RelativeValueInstrument = {
      symbol: "NIFTY",
      atm_iv: 0.18,
      put_iv: 0.21,
      call_iv: 0.17,
      skew: 0.04,
      net_gex: 1_500_000_000,
    };

    expect((row.atm_iv ?? 0) * 100).toBe(18);
    expect((row.skew ?? 0) * 100).toBeCloseTo(4);
    expect(row.net_gex).toBeGreaterThan(0);
  });
});
