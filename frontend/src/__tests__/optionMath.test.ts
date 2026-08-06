import { describe, it, expect } from "vitest";
import { daysToExpiry, timeToExpiry, nearestStrikeTo, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "../lib/optionMath";

describe("timeToExpiry", () => {
  it("returns a small positive floor when expiry is missing", () => {
    expect(timeToExpiry(null)).toBe(0.0001);
    expect(timeToExpiry(undefined)).toBe(0.0001);
  });

  it("computes a positive fraction of a year for a future expiry", () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const T = timeToExpiry(future.toISOString());
    expect(T).toBeGreaterThan(0);
    expect(T).toBeLessThan(1);
  });

  it("floors at a small positive value for a past expiry", () => {
    const past = new Date();
    past.setDate(past.getDate() - 30);
    expect(timeToExpiry(past.toISOString())).toBe(0.0001);
  });

  it("uses the CAS-era 15:40 IST close from 03-Aug-2026", () => {
    const before = timeToExpiry("2026-08-02", Date.parse("2026-08-02T10:01:00Z"));
    const after = timeToExpiry("2026-08-03", Date.parse("2026-08-03T10:01:00Z"));
    expect(before).toBe(0.0001); // 15:31 IST: pre-change session had ended.
    expect(after).toBeGreaterThan(0); // 15:31 IST: F&O still trades until 15:40.
  });
});

describe("daysToExpiry", () => {
  it("counts tomorrow as one calendar day in IST", () => {
    expect(daysToExpiry("06-Aug-2026", Date.parse("2026-08-05T09:41:00Z"))).toBe(1);
  });

  it("shows zero on the expiry calendar day even before market close", () => {
    expect(daysToExpiry("06-Aug-2026", Date.parse("2026-08-05T20:00:00Z"))).toBe(0); // 01:30 IST on expiry day
    expect(daysToExpiry("2026-08-06", Date.parse("2026-08-06T04:00:00Z"))).toBe(0);
  });
});

describe("nearestStrikeTo", () => {
  it("returns the target when there are no strikes", () => {
    expect(nearestStrikeTo([], 22000)).toBe(22000);
  });

  it("picks the closest strike, not the array midpoint", () => {
    // Regression test for the OptionChain.tsx ATM-strike bug: it used to
    // pick strikes[Math.floor(strikes.length / 2)] (array midpoint) instead
    // of the strike closest to spot. This chain is deliberately off-center.
    const strikes = [21000, 21500, 22000, 22500, 23000, 23500, 24000];
    // Midpoint index (3) would be 22500 — wrong. Closest to 21050 is 21000.
    expect(nearestStrikeTo(strikes, 21050)).toBe(21000);
  });

  it("breaks ties toward the lower strike (first found by reduce)", () => {
    expect(nearestStrikeTo([21900, 22100], 22000)).toBe(21900);
  });
});

describe("defaultSpotFallback", () => {
  it("returns the NIFTY fallback for NIFTY", () => {
    expect(defaultSpotFallback("NIFTY")).toBe(22000);
  });

  it("returns the SENSEX fallback for SENSEX", () => {
    expect(defaultSpotFallback("SENSEX")).toBe(80000);
  });

  it("returns the generic fallback for any other symbol", () => {
    expect(defaultSpotFallback("BANKNIFTY")).toBe(48000);
    expect(defaultSpotFallback("RELIANCE")).toBe(48000);
  });
});

describe("DEFAULT_RISK_FREE_RATE", () => {
  it("is 10%", () => {
    expect(DEFAULT_RISK_FREE_RATE).toBe(0.10);
  });
});
