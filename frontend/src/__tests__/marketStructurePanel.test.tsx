import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketStructurePanel } from "@/components/greek-workspace/MarketStructurePanel";
import type { Instrument, MarketTick } from "@/types/market";

const EXPIRY = "27-Aug-2026";

function makeInstrument(strike: number, optionType: "CE" | "PE"): Instrument {
  return {
    trading_symbol: `NSE:NIFTY${EXPIRY}${strike}${optionType}`,
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: EXPIRY,
    strike,
    option_type: optionType,
    exchange: "NFO",
    lot_size: 75,
    oi: 1000,
  };
}

function makeTick(tradingSymbol: string, lastPrice: number): MarketTick {
  return {
    trading_symbol: tradingSymbol,
    last_price: lastPrice,
    volume: 500,
    open_interest: 12000,
    timestamp: Date.now() / 1000,
    change: 1,
    change_percent: 1,
  };
}

describe("MarketStructurePanel", () => {
  it("shows a strike row and coverage metrics for each priced instrument", () => {
    const instruments = [makeInstrument(25000, "CE"), makeInstrument(25000, "PE")];
    const ticks: Record<string, MarketTick> = {
      [instruments[0].trading_symbol]: makeTick(instruments[0].trading_symbol, 150),
      [instruments[1].trading_symbol]: makeTick(instruments[1].trading_symbol, 140),
    };

    render(<MarketStructurePanel instruments={instruments} ticks={ticks} spot={25000} rate={0.1} />);

    expect(screen.getByText("OI quote coverage")).toBeTruthy();
    expect(screen.getByText("2/2")).toBeTruthy(); // both legs of the 25000 strike priced
    expect(screen.getByRole("cell", { name: "25000" })).toBeTruthy();
    expect(screen.getByText(/Scenario guide:/i)).toBeTruthy();
  });

  it("renders without crashing and shows zero coverage when there are no instruments", () => {
    render(<MarketStructurePanel instruments={[]} ticks={{}} spot={25000} rate={0.1} />);

    expect(screen.getByText("OI quote coverage")).toBeTruthy();
    expect(screen.getByText("0/0")).toBeTruthy();
    expect(screen.getByText("No crossing")).toBeTruthy();
  });

  it("switches the exposure convention via the sign-mode select", () => {
    const instruments = [makeInstrument(25000, "CE")];
    const ticks: Record<string, MarketTick> = {
      [instruments[0].trading_symbol]: makeTick(instruments[0].trading_symbol, 150),
    };
    render(<MarketStructurePanel instruments={instruments} ticks={ticks} spot={25000} rate={0.1} />);

    const select = screen.getByLabelText("Market structure exposure convention") as HTMLSelectElement;
    expect(select.value).toBe("neutral");

    fireEvent.change(select, { target: { value: "dealer-short" } });
    expect(select.value).toBe("dealer-short");
  });
});
