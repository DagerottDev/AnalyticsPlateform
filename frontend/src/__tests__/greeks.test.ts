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

describe("Second/third-order Greeks (finite-difference cross-validation)", () => {
  // Rather than hardcode reference numbers (easy to get subtly wrong by
  // hand), each analytic formula is checked against a central finite
  // difference of the relevant lower-order Greek — a self-verifying
  // property that holds regardless of the specific S/K/T/r/sigma chosen.
  const S = 100, K = 95, T = 0.5, r = 0.05, sigma = 0.25;
  const eps = 1e-4;

  it("vanna and charm are identical for CE and PE", () => {
    // delta_PE = delta_CE - 1 (a constant offset), so every higher-order
    // derivative of delta (vanna, charm) must be identical for CE/PE.
    const ce = calculateGreeks("CE", S, K, T, r, sigma);
    const pe = calculateGreeks("PE", S, K, T, r, sigma);
    expect(ce.vanna).toBeCloseTo(pe.vanna, 8);
    expect(ce.charm).toBeCloseTo(pe.charm, 8);
    expect(ce.speed).toBeCloseTo(pe.speed, 8);
    expect(ce.zomma).toBeCloseTo(pe.zomma, 8);
    expect(ce.vomma).toBeCloseTo(pe.vomma, 8);
    expect(ce.color).toBeCloseTo(pe.color, 8);
    expect(ce.ultima).toBeCloseTo(pe.ultima, 8);
  });

  it("vanna = d(delta)/d(sigma), scaled per 1% vol move", () => {
    const up = calculateGreeks("CE", S, K, T, r, sigma + eps).delta;
    const down = calculateGreeks("CE", S, K, T, r, sigma - eps).delta;
    const fd = (up - down) / (2 * eps) / 100; // /100: per-1%-vol scaling
    const { vanna } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(vanna).toBeCloseTo(fd, 4);
  });

  it("vomma = d(vega)/d(sigma)", () => {
    // .vega is already /100-scaled, so bumping it directly needs no
    // further scaling to match .vomma (unlike .delta/.gamma, which are raw).
    const up = calculateGreeks("CE", S, K, T, r, sigma + eps).vega;
    const down = calculateGreeks("CE", S, K, T, r, sigma - eps).vega;
    const fd = (up - down) / (2 * eps);
    const { vomma } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(vomma).toBeCloseTo(fd, 4);
  });

  it("charm = -d(delta)/d(T), scaled per day", () => {
    const up = calculateGreeks("CE", S, K, T + eps, r, sigma).delta;
    const down = calculateGreeks("CE", S, K, T - eps, r, sigma).delta;
    const fd = -((up - down) / (2 * eps)) / 365;
    const { charm } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(charm).toBeCloseTo(fd, 4);
  });

  it("speed = d(gamma)/d(S)", () => {
    const up = calculateGreeks("CE", S + eps, K, T, r, sigma).gamma;
    const down = calculateGreeks("CE", S - eps, K, T, r, sigma).gamma;
    const fd = (up - down) / (2 * eps);
    const { speed } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(speed).toBeCloseTo(fd, 4);
  });

  it("zomma = d(gamma)/d(sigma)", () => {
    const up = calculateGreeks("CE", S, K, T, r, sigma + eps).gamma;
    const down = calculateGreeks("CE", S, K, T, r, sigma - eps).gamma;
    const fd = (up - down) / (2 * eps);
    const { zomma } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(zomma).toBeCloseTo(fd, 4);
  });

  it("color = -d(gamma)/d(T), scaled per day", () => {
    const up = calculateGreeks("CE", S, K, T + eps, r, sigma).gamma;
    const down = calculateGreeks("CE", S, K, T - eps, r, sigma).gamma;
    const fd = -((up - down) / (2 * eps)) / 365;
    const { color } = calculateGreeks("CE", S, K, T, r, sigma);
    // color itself is O(1e-5) at these inputs, so the toBeCloseTo(fd, 4)
    // tolerance used by the other higher-order Greeks above is far too loose
    // here — it would silently pass even with a multi-percent formula error
    // (as happened previously: a spurious 2*r*T term made this off by ~2-5%
    // depending on r/T, undetected because the absolute gap stayed under
    // 1e-4). Assert relative error instead, sized to the actual quantity.
    expect(Math.abs(color - fd) / Math.abs(fd)).toBeLessThan(1e-3);
  });

  it("color matches finite difference across varied market conditions", () => {
    // Regression test for the bug above: the old formula's error scaled
    // with r*T, so it only showed up clearly away from the single fixed
    // S/K/T/r/sigma this describe block otherwise uses throughout.
    const cases: Array<[number, number, number, number, number]> = [
      [22000, 22100, 30 / 365, 0.10, 0.15],
      [100, 100, 0.5, 0.05, 0.20],
      [50000, 49000, 7 / 365, 0.10, 0.35],
      [18000, 17500, 45 / 365, 0.07, 0.25],
    ];
    const localEps = 1e-6;
    for (const [caseS, caseK, caseT, caseR, caseSigma] of cases) {
      const up = calculateGreeks("CE", caseS, caseK, caseT + localEps, caseR, caseSigma).gamma;
      const down = calculateGreeks("CE", caseS, caseK, caseT - localEps, caseR, caseSigma).gamma;
      const fd = -((up - down) / (2 * localEps)) / 365;
      const { color } = calculateGreeks("CE", caseS, caseK, caseT, caseR, caseSigma);
      expect(Math.abs(color - fd) / Math.abs(fd)).toBeLessThan(1e-3);
    }
  });

  it("ultima = d(vomma)/d(sigma)", () => {
    // .vomma is already /100-scaled, same reasoning as the vomma test above.
    const up = calculateGreeks("CE", S, K, T, r, sigma + eps).vomma;
    const down = calculateGreeks("CE", S, K, T, r, sigma - eps).vomma;
    const fd = (up - down) / (2 * eps);
    const { ultima } = calculateGreeks("CE", S, K, T, r, sigma);
    expect(ultima).toBeCloseTo(fd, 3);
  });
});
