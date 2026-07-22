/**
 * Zustand authentication store.
 *
 * Manages auth state with localStorage persistence.
 * Handles login via the Fyers API, logout, and session hydration.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthStore, TradingMode } from "@/types/auth";
import { autoLoginBroker, loginWithBroker, logoutUser } from "@/lib/auth";

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

      updateAccountName: (name: string) => {
        set((state) => {
          if (!state.user) return state;
          return {
            user: {
              ...state.user,
              account_name: name,
            },
          };
        });
      },

      clearError: () => {
        set({ error: null });
      },

      hydrate: async () => {
        // Triggered on app mount. If a session is already persisted in
        // localStorage, restore it. Otherwise, silently try a server-side
        // auto-login (backend/.env credentials) before ever showing the
        // login form — falls back to the form if that isn't configured
        const state = get();
        if (state.token && state.user) {
          set({ isAuthenticated: true });
          // Silently trigger auto-login to re-register the backend broker session
          // in case the server restarted or in-memory session was lost.
          autoLoginBroker()
            .then((response) => {
              set({
                token: response.access_token,
                user: response.user,
                isAuthenticated: true,
                error: null,
                tradingMode: response.user.trading_mode,
              });
            })
            .catch(() => {
              // Non-blocking catch for manual/custom sessions
            });
          return;
        }

        try {
          const response = await autoLoginBroker();
          set({
            token: response.access_token,
            user: response.user,
            isAuthenticated: true,
            error: null,
            tradingMode: response.user.trading_mode,
          });
        } catch {
          // No server-side credentials configured, or auto-login failed —
          // fall back to the manual login form.
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
