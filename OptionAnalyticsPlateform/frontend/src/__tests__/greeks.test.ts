import { describe, it, expect } from "vitest";
import { calculateGreeks, calculateImpliedVolatility, normCDF } from "../lib/greeks";

describe("Black-Scholes-Merton Greek Engine", () => {
  it("approximates normal CDF correctly", () => {
    // Known values
    expect(normCDF(0)).toBeCloseTo(0.5, 4);
    expect(normCDF(1.96)).toBeCloseTo(0.975, 3);
    expect(normCDF(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("calculates call option price and primary greeks correctly", () => {
    // S=100, K=100, T=1 (1 year), r=0.05, v=0.20
    const res = calculateGreeks("CE", 100, 100, 1, 0.05, 0.20);
    
    // Known values for these inputs:
    // d1 = (ln(1) + (0.05 + 0.02)*1) / 0.2 = 0.07 / 0.2 = 0.35
    // d2 = 0.35 - 0.2 = 0.15
    // N(d1) ~ 0.6368
    // Price ~ 10.4506
    expect(res.price).toBeCloseTo(10.45, 1);
    expect(res.delta).toBeCloseTo(0.6368, 2);
    expect(res.gamma).toBeCloseTo(0.0188, 3);
  });

  it("calculates put option delta correctly", () => {
    const res = calculateGreeks("PE", 100, 100, 1, 0.05, 0.20);
    // Put delta = Call delta - 1 = 0.6368 - 1 = -0.3632
    expect(res.delta).toBeCloseTo(-0.3632, 2);
  });

  it("calculates implied volatility correctly using Newton-Raphson", () => {
    // If we calculate IV for the exact price we got above, we should get 0.20 back
    const knownPrice = 10.45058; 
    const iv = calculateImpliedVolatility("CE", 100, 100, 1, 0.05, knownPrice);
    expect(iv).toBeCloseTo(0.20, 3);
  });

  it("handles intrinsic boundary when calculating IV", () => {
    // S=100, K=90. Intrinsic is 10.
    // If market price is 9 (below intrinsic), it should return very low IV or handle gracefully.
    const iv = calculateImpliedVolatility("CE", 100, 90, 1, 0.05, 9);
    expect(iv).toBeLessThan(0.01);
  });
});
