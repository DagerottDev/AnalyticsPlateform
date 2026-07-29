import { StrategyLeg } from "@/lib/strategy";

/** The notional balance used only to present a paper account summary. */
export const PAPER_STARTING_BALANCE = 1_000_000;

/** A fill is immutable evidence of the price used to open a simulated leg. */
export interface PaperFill {
  id: string;
  legId: string;
  tradingSymbol: string;
  action: "Buy" | "Sell";
  quantity: number;
  price: number;
  filledAt: string;
}

export interface PaperOrder {
  legs: StrategyLeg[];
  fills: PaperFill[];
  /** Net premium paid (+) or received (-), including quantity. */
  entryCost: number;
}

/**
 * Creates an immediately-filled paper order. Prices must be supplied from the
 * current market quote by the caller, so a paper fill can never silently use
 * an out-of-date strategy preview price.
 */
export function createPaperOrder(
  legs: StrategyLeg[],
  priceForSymbol: (tradingSymbol: string) => number | null | undefined,
  filledAt = new Date().toISOString()
): PaperOrder {
  if (legs.length === 0) {
    throw new Error("Add at least one complete leg before placing a paper order.");
  }

  let entryCost = 0;
  const filledLegs = legs.map((leg) => {
    if (!leg.instrument) {
      throw new Error("Every paper-trading leg needs an instrument.");
    }
    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
      throw new Error("Paper-trading quantity must be greater than zero.");
    }

    const price = priceForSymbol(leg.instrument.trading_symbol);
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`A live price is not available for ${leg.instrument.trading_symbol}.`);
    }

    const signedNotional = price * leg.quantity * (leg.action === "Buy" ? 1 : -1);
    entryCost += signedNotional;
    return { ...leg, entryPrice: price };
  });

  const fills = filledLegs.map((leg, index) => ({
    id: `${leg.id}-${filledAt}-${index}`,
    legId: leg.id,
    tradingSymbol: leg.instrument!.trading_symbol,
    action: leg.action,
    quantity: leg.quantity,
    price: leg.entryPrice,
    filledAt,
  }));

  return { legs: filledLegs, fills, entryCost };
}

export interface PaperAccountSummary {
  startingBalance: number;
  availableCash: number;
  realizedPnl: number;
  unrealizedPnl: number;
  runningPnl: number;
  equity: number;
}

/** Builds a paper-account balance from its order ledger and current marks. */
export function calculatePaperAccountSummary({
  startingBalance = PAPER_STARTING_BALANCE,
  openEntryCost,
  closedCloseValue,
  realizedPnl,
  unrealizedPnl,
}: {
  startingBalance?: number;
  openEntryCost: number;
  closedCloseValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
}): PaperAccountSummary {
  const runningPnl = realizedPnl + unrealizedPnl;
  return {
    startingBalance,
    // Opening a debit consumes cash; a credit strategy increases it. Closing
    // positions returns their signed mark value to the simulated account.
    availableCash: startingBalance - openEntryCost + closedCloseValue,
    realizedPnl,
    unrealizedPnl,
    runningPnl,
    equity: startingBalance + runningPnl,
  };
}
