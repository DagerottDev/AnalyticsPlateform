import type { Instrument } from "@/types/market";

export type BasketSide = "Buy" | "Sell";

export interface BasketLegDraft {
  id: string;
  instrument: Instrument;
  side: BasketSide;
  quantity: number;
  stopLoss?: number;
  targetPrice?: number;
}

export interface BasketRiskDraft {
  combinedStopLoss?: number;
  combinedTarget?: number;
}

/** Keep protective/debit buys ahead of sells wherever a basket is shown,
 * estimated, or submitted. The stable ordering retains the user's sequence
 * inside each side and lets brokers evaluate spread margin benefits before
 * the short legs are entered. */
export function orderBasketLegsForMargin(legs: BasketLegDraft[]): BasketLegDraft[] {
  return legs
    .map((leg, index) => ({ leg, index }))
    .sort((left, right) => {
      const leftPriority = left.leg.side === "Buy" ? 0 : 1;
      const rightPriority = right.leg.side === "Buy" ? 0 : 1;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ leg }) => leg);
}

export function validateBasketLeg(leg: BasketLegDraft, referencePrice: number | null | undefined): string | null {
  const lotSize = leg.instrument.lot_size || 0;
  if (!Number.isFinite(leg.quantity) || leg.quantity <= 0 || (lotSize > 0 && leg.quantity % lotSize !== 0)) {
    return `Quantity must be a multiple of ${lotSize || 1}.`;
  }
  if (!referencePrice || referencePrice <= 0) return "A live premium is required to place this basket.";
  if (leg.stopLoss != null && leg.stopLoss > 0) {
    const valid = leg.side === "Buy" ? leg.stopLoss < referencePrice : leg.stopLoss > referencePrice;
    if (!valid) return `${leg.side} stop-loss must be ${leg.side === "Buy" ? "below" : "above"} the current premium.`;
  }
  if (leg.targetPrice != null && leg.targetPrice > 0) {
    const valid = leg.side === "Buy" ? leg.targetPrice > referencePrice : leg.targetPrice < referencePrice;
    if (!valid) return `${leg.side} target must be ${leg.side === "Buy" ? "above" : "below"} the current premium.`;
  }
  return null;
}

/** Compact and versioned enough for a new Strategy Builder window. */
export function serializeBasketForStrategy(legs: BasketLegDraft[], prices: Record<string, number>): string {
  return encodeURIComponent(JSON.stringify(legs.map(leg => ({
    s: leg.instrument.trading_symbol,
    a: leg.side,
    q: leg.quantity,
    p: prices[leg.instrument.trading_symbol] || 0,
  }))));
}

export interface StrategyBasketLeg {
  s: string;
  a: BasketSide;
  q: number;
  p: number;
}

export function parseStrategyBasket(value: string | null): StrategyBasketLeg[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StrategyBasketLeg => (
      typeof item === "object" && item !== null &&
      typeof (item as StrategyBasketLeg).s === "string" &&
      ((item as StrategyBasketLeg).a === "Buy" || (item as StrategyBasketLeg).a === "Sell") &&
      Number.isFinite((item as StrategyBasketLeg).q) && Number.isFinite((item as StrategyBasketLeg).p)
    ));
  } catch {
    return [];
  }
}
