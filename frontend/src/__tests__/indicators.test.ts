import { describe, it, expect } from "vitest";
import {
  calculateSMA,
  calculateEMA,
  calculateWMA,
  calculateHMA,
  calculateVWMA,
  calculateStochasticRSI,
  calculateZScore,
  calculateDonchian,
  calculateATR,
  calculateADX,
  calculateSupertrend,
  OHLCVData,
} from "../lib/indicators";

describe("Technical Indicators", () => {
  const mockData: OHLCVData[] = [
    { time: 1, open: 10, high: 12, low: 8, close: 10 },
    { time: 2, open: 10, high: 13, low: 9, close: 11 },
    { time: 3, open: 11, high: 14, low: 10, close: 12 },
    { time: 4, open: 12, high: 15, low: 11, close: 13 },
    { time: 5, open: 13, high: 16, low: 12, close: 14 },
    { time: 6, open: 14, high: 17, low: 13, close: 15 },
    { time: 7, open: 15, high: 18, low: 14, close: 16 },
    { time: 8, open: 16, high: 19, low: 15, close: 17 },
    { time: 9, open: 17, high: 20, low: 16, close: 18 },
    { time: 10, open: 18, high: 21, low: 17, close: 19 },
  ];

  it("calculates SMA correctly", () => {
    const sma = calculateSMA(mockData, 3);
    expect(sma).toHaveLength(8); // 10 - 3 + 1
    // First SMA = (10 + 11 + 12) / 3 = 11
    expect(sma[0].value).toBe(11);
    // Last SMA = (17 + 18 + 19) / 3 = 18
    expect(sma[sma.length - 1].value).toBe(18);
  });

  it("calculates EMA correctly", () => {
    const ema = calculateEMA(mockData, 3);
    expect(ema).toHaveLength(8);
    // First EMA is just SMA = 11
    expect(ema[0].value).toBe(11);
    // Second EMA = 13 * (2/4) + 11 * (2/4) = 12
    expect(ema[1].value).toBe(12);
  });

  it("calculates WMA correctly (most recent bar weighted highest)", () => {
    const wma = calculateWMA(mockData, 3);
    expect(wma).toHaveLength(8);
    // WMA[0] over closes 10,11,12 weighted 1,2,3: (10*1 + 11*2 + 12*3) / 6 = 68/6
    expect(wma[0].value).toBeCloseTo(68 / 6, 2);
  });

  it("calculates VWMA correctly (volume-weighted)", () => {
    const withVolume: OHLCVData[] = [
      { time: 1, open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { time: 2, open: 10, high: 13, low: 9, close: 20, volume: 300 },
      { time: 3, open: 11, high: 14, low: 10, close: 30, volume: 100 },
    ];
    const vwma = calculateVWMA(withVolume, 3);
    // (10*100 + 20*300 + 30*100) / (100+300+100) = 10000/500 = 20
    expect(vwma).toHaveLength(1);
    expect(vwma[0].value).toBeCloseTo(20, 2);
  });

  it("calculates HMA as a length-correct, non-NaN series that tracks a monotonic trend", () => {
    const hma = calculateHMA(mockData, 4);
    expect(hma.length).toBeGreaterThan(0);
    hma.forEach(p => expect(Number.isNaN(p.value)).toBe(false));
    // For a strictly increasing price series, HMA should also be non-decreasing.
    for (let i = 1; i < hma.length; i++) {
      expect(hma[i].value).toBeGreaterThanOrEqual(hma[i - 1].value);
    }
  });

  it("calculates Stochastic RSI within the 0-100 bound", () => {
    const stochRsi = calculateStochasticRSI(mockData, 3, 3);
    expect(stochRsi.length).toBeGreaterThan(0);
    stochRsi.forEach(p => {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    });
  });

  it("calculates Z-score correctly against a hand-computed window", () => {
    const z = calculateZScore(mockData, 3);
    // Window [10,11,12]: mean=11, population stdDev=sqrt(((1)^2+0^2+1^2)/3)=sqrt(2/3)
    const expectedStdDev = Math.sqrt(2 / 3);
    expect(z[0].value).toBeCloseTo((12 - 11) / expectedStdDev, 3);
  });

  it("calculates Donchian channel correctly", () => {
    const donchian = calculateDonchian(mockData, 3);
    // Window over data[0..2]: highs 12,13,14 -> upper=14; lows 8,9,10 -> lower=8
    expect(donchian[0].upper).toBe(14);
    expect(donchian[0].lower).toBe(8);
    expect(donchian[0].middle).toBe(11);
  });

  it("calculates ATR correctly for a constant-true-range series", () => {
    // mockData's high-low range and the gap to the prior close are both
    // constant across bars, so True Range — and therefore ATR — is a
    // constant 4 throughout.
    const atr = calculateATR(mockData, 3);
    expect(atr).toHaveLength(7);
    atr.forEach(p => expect(p.value).toBeCloseTo(4, 2));
  });

  it("calculates ADX/+DI/-DI correctly for a clean, uninterrupted uptrend", () => {
    // mockData's highs and lows both rise by a constant 1 per bar, so
    // +DM is constant, -DM is zero, and TR is constant — a fully
    // deterministic, hand-verifiable case: +DI=25, -DI=0, ADX=100.
    const adx = calculateADX(mockData, 3);
    expect(adx).toHaveLength(5);
    adx.forEach(p => {
      expect(p.plusDI).toBeCloseTo(25, 2);
      expect(p.minusDI).toBeCloseTo(0, 2);
      expect(p.adx).toBeCloseTo(100, 2);
    });
  });

  it("keeps the Supertrend line on the correct side of price by construction", () => {
    // Structural invariant, true regardless of dataset/parameters: in a
    // "down" state the line is resistance (>= close); in an "up" state
    // it's support (<= close) — that's what determines the state itself.
    const supertrend = calculateSupertrend(mockData, 3, 3);
    const closesByBar = new Map(mockData.map(d => [d.time, d.close]));
    supertrend.forEach(p => {
      const close = closesByBar.get(p.time)!;
      if (p.trend === "down") expect(p.value).toBeGreaterThanOrEqual(close);
      else expect(p.value).toBeLessThanOrEqual(close);
    });
  });

  it("flips from down to up once a tighter band is broken by the uptrend", () => {
    // With a narrower band (multiplier=1) on the same rising series, price
    // eventually closes above the upper band and Supertrend must flip.
    const supertrend = calculateSupertrend(mockData, 3, 1);
    const last = supertrend[supertrend.length - 1];
    expect(last.trend).toBe("up");
    expect(last.value).toBeLessThan(mockData[mockData.length - 1].close);
  });
});
