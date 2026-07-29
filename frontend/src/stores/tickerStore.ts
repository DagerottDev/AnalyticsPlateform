import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persisted app-wide watchlist. `tickers` remains the state key for backward
 * compatibility with the Dashboard ticker cards and existing localStorage.
 */
interface WatchlistState {
  tickers: string[];
  addTicker: (symbol: string) => void;
  removeTicker: (symbol: string) => void;
  setTickers: (symbols: string[]) => void;
  resetTickers: () => void;
}

const DEFAULT_WATCHLIST = ["NIFTY", "BANKNIFTY"];

export const useTickerStore = create<WatchlistState>()(
  persist(
    (set) => ({
      tickers: DEFAULT_WATCHLIST,

      addTicker: (symbol: string) => {
        const formatted = symbol.trim().toUpperCase();
        if (!formatted) return;
        set((state) => {
          if (state.tickers.includes(formatted)) return state;
          return { tickers: [...state.tickers, formatted] };
        });
      },

      removeTicker: (symbol: string) => {
        set((state) => {
          // Keep at least 1 ticker
          if (state.tickers.length <= 1) return state;
          return { tickers: state.tickers.filter((t) => t !== symbol) };
        });
      },

      setTickers: (symbols: string[]) => {
        const cleaned = Array.from(
          new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))
        );
        if (cleaned.length > 0) {
          set({ tickers: cleaned });
        }
      },

      resetTickers: () => set({ tickers: DEFAULT_WATCHLIST }),
    }),
    { name: "ticker-storage" }
  )
);

/** Preferred name for new consumers; the Dashboard alias remains supported. */
export const useWatchlistStore = useTickerStore;
