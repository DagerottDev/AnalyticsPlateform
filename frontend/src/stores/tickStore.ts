import { create } from "zustand";
import { MarketTick } from "@/types/market";

interface TickState {
  ticks: Record<string, MarketTick>;
  setTick: (tick: MarketTick) => void;
  setTicks: (ticks: MarketTick[]) => void;
}

/**
 * Live prices for the pinned dashboard tickers (see tickerStore), kept in a
 * plain module-level Zustand store — not tied to any single component's
 * lifetime — so the last-known price survives Dashboard unmounting on
 * navigation instead of resetting to empty (see TickerFeedMount).
 */
export const useTickStore = create<TickState>((set) => ({
  ticks: {},
  setTick: (tick) =>
    set((state) => ({ ticks: { ...state.ticks, [tick.trading_symbol]: tick } })),
  setTicks: (ticks) =>
    set((state) => {
      const updated = { ...state.ticks };
      for (const tick of ticks) updated[tick.trading_symbol] = tick;
      return { ticks: updated };
    }),
}));
