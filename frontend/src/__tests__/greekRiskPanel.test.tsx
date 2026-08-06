import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GreekRiskPanel } from "@/components/greek-workspace/GreekRiskPanel";
import type { StrategyLeg } from "@/lib/strategy";
import type { Instrument, MarketTick } from "@/types/market";

const instrument: Instrument = {
  trading_symbol: "NSE:NIFTY27AUG2026CE25000",
  symbol: "NIFTY",
  instrument_type: "OPTIDX",
  expiry: "27-Aug-2026",
  strike: 25000,
  option_type: "CE",
  exchange: "NFO",
  lot_size: 75,
};

function makeTick(overrides: Partial<MarketTick> = {}): MarketTick {
  return {
    trading_symbol: instrument.trading_symbol,
    last_price: 150,
    volume: 500,
    open_interest: 1000,
    timestamp: Date.now() / 1000,
    change: 1,
    change_percent: 1,
    ...overrides,
  };
}

describe("GreekRiskPanel", () => {
  it("prompts to add a leg when the strategy has no priced legs yet", () => {
    render(<GreekRiskPanel legs={[]} ticks={{}} spot={25000} candles={[]} rate={0.1} />);

    expect(screen.getByText("Greek scenarios")).toBeTruthy();
    expect(screen.getByText(/Add a strategy leg/i)).toBeTruthy();
  });

  it("also shows the placeholder when every leg is missing its instrument", () => {
    const legs: StrategyLeg[] = [{ id: "leg-1", instrument: null, action: "Buy", quantity: 75, entryPrice: 0, iv: 0.15 }];
    render(<GreekRiskPanel legs={legs} ticks={{}} spot={25000} candles={[]} rate={0.1} />);

    expect(screen.getByText(/Add a strategy leg/i)).toBeTruthy();
  });

  it("renders the contract table and Greek exposure tiles once a leg has an instrument", () => {
    const legs: StrategyLeg[] = [
      { id: "leg-1", instrument, action: "Buy", quantity: 75, entryPrice: 145, iv: 0.15 },
    ];
    const ticks: Record<string, MarketTick> = { [instrument.trading_symbol]: makeTick() };

    render(<GreekRiskPanel legs={legs} ticks={ticks} spot={25000} candles={[]} rate={0.1} />);

    expect(screen.getByText("Greek scenarios — My Risk")).toBeTruthy();
    expect(screen.getByRole("cell", { name: instrument.trading_symbol })).toBeTruthy();
    expect(screen.getByText("₹ delta")).toBeTruthy();
    expect(screen.getByText(/ATR-based scenario grid/i)).toBeTruthy();
  });
});
