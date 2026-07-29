import { describe, expect, it } from "vitest";
import { calculatePaperAccountSummary, createPaperOrder } from "@/lib/paperTrading";
import type { StrategyLeg } from "@/lib/strategy";

const call = {
  trading_symbol: "NIFTY24AUG22000CE",
  symbol: "NIFTY",
  instrument_type: "OPTIDX",
  expiry: "2026-08-27T00:00:00.000Z",
  strike: 22000,
  option_type: "CE" as const,
  exchange: "NFO",
};

describe("paper trading", () => {
  it("creates immediate fills at the supplied live prices and preserves debit/credit signs", () => {
    const legs: StrategyLeg[] = [
      { id: "long", instrument: call, action: "Buy", quantity: 50, entryPrice: 0, iv: 0.2 },
      { id: "short", instrument: { ...call, trading_symbol: "NIFTY24AUG22100CE" }, action: "Sell", quantity: 50, entryPrice: 0, iv: 0.2 },
    ];
    const order = createPaperOrder(legs, symbol => symbol.includes("22100") ? 40 : 70, "2026-07-29T10:00:00.000Z");

    expect(order.entryCost).toBe(1500);
    expect(order.legs.map(leg => leg.entryPrice)).toEqual([70, 40]);
    expect(order.fills).toHaveLength(2);
    expect(order.fills[0]).toMatchObject({ action: "Buy", price: 70, quantity: 50 });
  });

  it("rejects an order when a current quote is unavailable", () => {
    const legs: StrategyLeg[] = [{ id: "long", instrument: call, action: "Buy", quantity: 1, entryPrice: 0, iv: 0.2 }];
    expect(() => createPaperOrder(legs, () => null)).toThrow("live price is not available");
  });

  it("combines realized and live P&L into account equity", () => {
    const summary = calculatePaperAccountSummary({
      startingBalance: 100_000,
      openEntryCost: 5_000,
      closedCloseValue: 2_500,
      realizedPnl: 500,
      unrealizedPnl: -125,
    });
    expect(summary.availableCash).toBe(97_500);
    expect(summary.runningPnl).toBe(375);
    expect(summary.equity).toBe(100_375);
  });
});
