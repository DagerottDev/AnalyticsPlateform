import { describe, expect, it } from "vitest";
import { expectedIvRange } from "@/lib/ivUniverse";

describe("expectedIvRange", () => {
  it("uses annualized decimal ATM IV with calendar days and sigma", () => {
    const range = expectedIvRange(1000, 0.2, 30, 1.5);

    expect(range?.move).toBeCloseTo(86.0073, 4);
    expect(range?.lower).toBeCloseTo(913.9927, 4);
    expect(range?.upper).toBeCloseTo(1086.0073, 4);
  });

  it("returns no projection when the stored spot or ATM IV is absent", () => {
    expect(expectedIvRange(null, 0.2, 14, 1)).toBeNull();
    expect(expectedIvRange(1000, null, 14, 1)).toBeNull();
  });
});
