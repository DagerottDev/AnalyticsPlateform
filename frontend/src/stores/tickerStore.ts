import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Persisted app-wide watchlist. `tickers` remains the state key for backward
 * compatibility with the Dashboard ticker cards and existing localStorage.
 */
interface WatchlistState {
  tickers: string[];
  addTicker: (symbol: string) => void;
  removeTicker: (symbol: string) => void;
  setTickers: (symbols: string[]) => void;
  setTickersFromPreferences: (symbols: string[]) => void;
  resetTickers: () => void;
}

const DEFAULT_WATCHLIST = ["NIFTY", "BANKNIFTY"];

function cleanSymbols(symbols: string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))).slice(0, 20);
}

export const useTickerStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      tickers: DEFAULT_WATCHLIST,

      addTicker: (symbol: string) => {
        const formatted = symbol.trim().toUpperCase();
        if (!formatted) return;
        const next = cleanSymbols([...get().tickers, formatted]);
        if (next.join(",") === get().tickers.join(",")) return;
        set({ tickers: next });
        useSettingsStore.getState().updatePreferences((current) => ({ ...current, general: { ...current.general, watchlist: next } }));
      },

      removeTicker: (symbol: string) => {
        const current = get().tickers;
        if (current.length <= 1) return;
        const next = current.filter((ticker) => ticker !== symbol);
        set({ tickers: next });
        useSettingsStore.getState().updatePreferences((preferences) => ({ ...preferences, general: { ...preferences.general, watchlist: next } }));
      },

      setTickers: (symbols: string[]) => {
        const cleaned = cleanSymbols(symbols);
        if (cleaned.length > 0) {
          set({ tickers: cleaned });
          useSettingsStore.getState().updatePreferences((preferences) => ({ ...preferences, general: { ...preferences.general, watchlist: cleaned } }));
        }
      },

      setTickersFromPreferences: (symbols: string[]) => {
        const cleaned = cleanSymbols(symbols);
        if (cleaned.length > 0) set({ tickers: cleaned });
      },

      resetTickers: () => {
        set({ tickers: DEFAULT_WATCHLIST });
        useSettingsStore.getState().updatePreferences((preferences) => ({ ...preferences, general: { ...preferences.general, watchlist: DEFAULT_WATCHLIST } }));
      },
    }),
    { name: "ticker-storage" }
  )
);

/** Preferred name for new consumers; the Dashboard alias remains supported. */
export const useWatchlistStore = useTickerStore;
