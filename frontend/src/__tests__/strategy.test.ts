import { describe, it, expect } from "vitest";
import { 
  calculatePayoffProfile, 
  deriveMetricsFromProfile,
  StrategyLeg 
} from "../lib/strategy";

describe("Strategy Builder Engine", () => {
  const dummyInstrumentCE = {
    trading_symbol: "NIFTY24DEC22000CE",
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: new Date(new Date().getTime() + 86400000 * 10).toISOString(), // 10 days
    strike: 22000,
    option_type: "CE" as const,
    exchange: "NFO",
  };

  const dummyInstrumentPE = {
    ...dummyInstrumentCE,
    trading_symbol: "NIFTY24DEC22000PE",
    option_type: "PE" as const,
  };

  it("calculates Long Call payoff correctly", () => {
    const legs: StrategyLeg[] = [
      {
        id: "1",
        instrument: dummyInstrumentCE,
        action: "Buy",
        quantity: 1, // 1 Lot for simplicity of test, but actually quantity = 25
        entryPrice: 100, // Premium paid
        iv: 0.15
      }
    ];

    const profile = calculatePayoffProfile(legs, 22000, 0.10, 0.10, 100);
    expect(profile.length).toBeGreaterThan(0);

    const metrics = deriveMetricsFromProfile(profile);
    
    // Max loss is premium paid: 100 * 1 = -100
    // Actually the profile is just evaluated over a range. Let's see maxLoss
    expect(metrics.maxLoss).toBeCloseTo(-100, 0);
    // Breakeven should be Strike + Premium = 22100
    expect(metrics.breakevens.length).toBe(1);
    expect(metrics.breakevens[0]).toBeCloseTo(22100, 0);
  });

  it("calculates Short Put payoff correctly", () => {
    const legs: StrategyLeg[] = [
      {
        id: "1",
        instrument: dummyInstrumentPE,
        action: "Sell",
        quantity: 1,
        entryPrice: 150, // Premium received
        iv: 0.15
      }
    ];

    const profile = calculatePayoffProfile(legs, 22000, 0.10, 0.10, 100);
    const metrics = deriveMetricsFromProfile(profile);

    // Max profit is premium received = 150
    expect(metrics.maxProfit).toBeCloseTo(150, 0);
    // Breakeven is Strike - Premium = 21850
    expect(metrics.breakevens.length).toBe(1);
    expect(metrics.breakevens[0]).toBeCloseTo(21850, 0);
  });
});
