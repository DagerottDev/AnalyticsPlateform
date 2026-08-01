"use client";

import { useEffect, useMemo } from "react";
import { createPaperOrder } from "@/lib/paperTrading";
import { useMarketData } from "@/hooks/useMarketData";
import { usePaperGttStore } from "@/stores/paperGttStore";
import { usePositionStore } from "@/stores/positionStore";

export function PaperGttMonitorMount() {
  const orders = usePaperGttStore((state) => state.orders);
  const finish = usePaperGttStore((state) => state.finish);
  const execute = usePositionStore((state) => state.executePaperOrder);
  const symbols = useMemo(() => orders.filter((order) => order.status === "Pending").map((order) => order.symbol), [orders]);
  const { getTick } = useMarketData(symbols);
  useEffect(() => { orders.filter((order) => order.status === "Pending").forEach((order) => {
    if (new Date(order.expiresAt).getTime() <= Date.now()) { finish(order.id, "Expired"); return; }
    const price = getTick(order.symbol)?.last_price;
    const triggerHit = price && (order.side === "Buy" ? price >= order.triggerPrice : price <= order.triggerPrice);
    const fillable = order.executionType === "MARKET" || (price && (order.side === "Buy" ? order.limitPrice >= price : order.limitPrice <= price));
    if (!triggerHit || !fillable || !price) return;
    const fill = order.executionType === "LIMIT" ? order.limitPrice : price;
    const leg = { id: order.id, instrument: order.instrument, action: order.side, quantity: order.quantity, entryPrice: 0, iv: 0 };
    const paper = createPaperOrder([leg], () => fill);
    execute({ symbol: order.instrument.symbol, label: `${order.symbol} • Paper GTT`, legs: paper.legs, entryCost: paper.entryCost, fills: paper.fills });
    finish(order.id, "Placed");
  }); }, [execute, finish, getTick, orders]);
  return null;
}
