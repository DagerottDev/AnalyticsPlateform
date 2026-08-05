import { create } from "zustand";
import { MarketTick } from "@/types/market";
import { mergeMarketTick } from "@/lib/marketTick";

interface TickState {
  ticks: Record<string, MarketTick>;
  setTick: (tick: MarketTick) => void;
  setTicks: (ticks: MarketTick[]) => void;
  clear: () => void;
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
    set((state) => ({
      ticks: {
        ...state.ticks,
        [tick.trading_symbol]: mergeMarketTick(state.ticks[tick.trading_symbol], tick),
      },
    })),
  setTicks: (ticks) =>
    set((state) => {
      const updated = { ...state.ticks };
      for (const tick of ticks) updated[tick.trading_symbol] = mergeMarketTick(updated[tick.trading_symbol], tick);
      return { ticks: updated };
    }),
  clear: () => set({ ticks: {} }),
}));
