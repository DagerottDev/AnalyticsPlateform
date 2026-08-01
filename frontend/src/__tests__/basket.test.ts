import { describe, expect, it } from "vitest";
import { orderBasketLegsForMargin, parseStrategyBasket, serializeBasketForStrategy, validateBasketLeg } from "@/lib/basket";

const instrument = {
  trading_symbol: "NFO:NIFTY26AUG22000CE", symbol: "NIFTY", instrument_type: "OPTIDX",
  expiry: "2026-08-27", strike: 22000, option_type: "CE" as const, exchange: "NFO", lot_size: 50,
};

describe("basket drafts", () => {
  it("validates side-aware premium stops and targets", () => {
    expect(validateBasketLeg({ id: "buy", instrument, side: "Buy", quantity: 50, stopLoss: 90, targetPrice: 120 }, 100)).toBeNull();
    expect(validateBasketLeg({ id: "buy", instrument, side: "Buy", quantity: 50, stopLoss: 110 }, 100)).toMatch(/below/);
    expect(validateBasketLeg({ id: "sell", instrument, side: "Sell", quantity: 50, stopLoss: 110, targetPrice: 90 }, 100)).toBeNull();
    expect(validateBasketLeg({ id: "sell", instrument, side: "Sell", quantity: 25 }, 100)).toMatch(/multiple/);
  });

  it("round-trips an editable Strategy Builder handoff", () => {
    const value = serializeBasketForStrategy([{ id: "1", instrument, side: "Sell", quantity: 50 }], { [instrument.trading_symbol]: 98.5 });
    expect(parseStrategyBasket(value)).toEqual([{ s: instrument.trading_symbol, a: "Sell", q: 50, p: 98.5 }]);
  });

  it("keeps buys before sells while retaining the order within each side", () => {
    const ordered = orderBasketLegsForMargin([
      { id: "sell-one", instrument, side: "Sell", quantity: 50 },
      { id: "buy-one", instrument, side: "Buy", quantity: 50 },
      { id: "sell-two", instrument, side: "Sell", quantity: 50 },
      { id: "buy-two", instrument, side: "Buy", quantity: 50 },
    ]);

    expect(ordered.map((leg) => leg.id)).toEqual(["buy-one", "buy-two", "sell-one", "sell-two"]);
  });
});
