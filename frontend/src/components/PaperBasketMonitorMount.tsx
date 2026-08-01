"use client";

import { useEffect, useMemo } from "react";
import { useMarketData } from "@/hooks/useMarketData";
import { usePositionStore } from "@/stores/positionStore";

/**
 * Browser-resident counterpart to the server live-basket monitor.  Paper
 * positions are intentionally local-only, so protection can run only while
 * this app is open and receiving market ticks.
 */
export function PaperBasketMonitorMount() {
  const positions = usePositionStore(state => state.positions);
  const settleBasketLeg = usePositionStore(state => state.settleBasketLeg);
  const settleBasket = usePositionStore(state => state.settleBasket);
  const symbols = useMemo(() => Array.from(new Set(
    positions.filter(position => position.status === "Open" && position.basketRisk)
      .flatMap(position => position.legs
        .filter(leg => leg.instrument && !position.legExits?.[leg.id])
        .map(leg => leg.instrument!.trading_symbol))
  )), [positions]);
  const { getTick } = useMarketData(symbols);

  useEffect(() => {
    positions.forEach(position => {
      if (position.status !== "Open" || !position.basketRisk) return;
      const prices: Record<string, number> = {};
      let allOpenPricesReady = true;
      let combinedPnl = 0;

      position.legs.forEach(leg => {
        const exit = position.legExits?.[leg.id];
        const price = exit?.price ?? (leg.instrument ? getTick(leg.instrument.trading_symbol)?.last_price : undefined);
        if (!price || price <= 0) {
          if (!exit) allOpenPricesReady = false;
          return;
        }
        prices[leg.id] = price;
        const sign = leg.action === "Buy" ? 1 : -1;
        combinedPnl += (price - leg.entryPrice) * leg.quantity * sign;
        if (exit) return;
        const risk = position.basketRisk!.legRisk[leg.id];
        if (!risk) return;
        const stopHit = risk.stopLoss != null && (leg.action === "Buy" ? price <= risk.stopLoss : price >= risk.stopLoss);
        const targetHit = risk.targetPrice != null && (leg.action === "Buy" ? price >= risk.targetPrice : price <= risk.targetPrice);
        if (stopHit || targetHit) {
          settleBasketLeg(position.id, leg.id, price, stopHit ? "Leg stop-loss hit" : "Leg target hit");
        }
      });

      if (!allOpenPricesReady) return;
      const { combinedStopLoss, combinedTarget } = position.basketRisk;
      const combinedReason = combinedStopLoss != null && combinedPnl <= -Math.abs(combinedStopLoss)
        ? "Combined stop-loss hit"
        : combinedTarget != null && combinedPnl >= combinedTarget
          ? "Combined target hit"
          : null;
      if (combinedReason) settleBasket(position.id, prices, combinedReason);
    });
  }, [getTick, positions, settleBasket, settleBasketLeg]);

  return null;
}
