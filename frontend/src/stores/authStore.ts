/**
 * Zustand authentication store.
 *
 * Manages auth state with localStorage persistence.
 * Handles login via the Fyers API, logout, and session hydration.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthStore, TradingMode } from "@/types/auth";
import { loginWithBroker, logoutUser } from "@/lib/auth";

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // ─── State ─────────────────────────────────────────
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      tradingMode: "paper" as TradingMode,

      // ─── Actions ───────────────────────────────────────
      login: async (request) => {
        set({ isLoading: true, error: null });
        try {
          const response = await loginWithBroker(request);
          set({
            token: response.access_token,
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            tradingMode: response.user.trading_mode,
          });
        } catch (error: unknown) {
          set({
            token: null,
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: error,
          });
          throw error;
        }
      },

      logout: () => {
        // Fire-and-forget server-side logout
        logoutUser();
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      setTradingMode: (mode: TradingMode) => {
        set({ tradingMode: mode });
      },

      clearError: () => {
        set({ error: null });
      },

      hydrate: () => {
        // Triggered on app mount to restore session from localStorage
        const state = get();
        if (state.token && state.user) {
          set({ isAuthenticated: true });
        }
      },
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        tradingMode: state.tradingMode,
      }),
    }
  )
);
