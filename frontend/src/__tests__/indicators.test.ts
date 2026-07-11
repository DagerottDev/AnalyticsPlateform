import { describe, it, expect } from "vitest";
import { calculateSMA, calculateEMA, calculateRSI, OHLCVData } from "../lib/indicators";

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
});
