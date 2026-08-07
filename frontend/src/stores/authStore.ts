/**
 * Zustand authentication store.
 *
 * Manages auth state with localStorage persistence.
 * Handles login via the Fyers API, logout, and session hydration.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AuthStore, TradingMode } from "@/types/auth";
import {
  autoLoginBroker,
  loginWithBroker,
  logoutUser,
  verifyBrokerSession,
} from "@/lib/auth";

// hydrate() is called from every useAuth()-consuming component's mount
// effect (Header, DashboardLayout, and several pages all call it), and
// DashboardLayout is wrapped inside each page rather than a shared Next.js
// layout, so it fully remounts on every navigation. Without this cache,
// each of those mounts independently fires its own autoLoginBroker() call —
// on a server with no FYERS_* auto-login credentials configured, that's a
// burst of guaranteed-503 requests on every single page navigation. Caching
// the hydration result means the local session is restored once per page
// load while the broker reconnection remains a single background request.
let hydratePromise: Promise<void> | null = null;

// Mirrors hydratePromise: DashboardLayout is rendered per-page rather than
// from one shared layout, so later mounts should not show a startup loader
// after the local browser state has already been restored.
let hasHydratedOnce = false;

export function isAuthHydrated(): boolean {
  return hasHydratedOnce;
}

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
      sessionLive: true,

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
            sessionLive: true,
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
          sessionLive: true,
        });
      },

      setSessionLive: (live) => {
        set({ sessionLive: live });
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

      hydrate: () => {
        // Local storage is synchronous, so the app can render as soon as
        // that state is known. Re-registering an in-memory broker session
        // may take several seconds, and must never keep the whole platform
        // behind the startup loader.
        if (!hydratePromise) {
          const state = get();
          const persistedToken = state.token;
          const hadPersistedSession = Boolean(persistedToken && state.user);

          if (hadPersistedSession) {
            set({ isAuthenticated: true });
          }

          hasHydratedOnce = true;
          hydratePromise = Promise.resolve();

          // The backend persists and restores the broker service itself. If
          // this browser already has a JWT, verify that restored service
          // first; logging into Fyers again would replace it and kill every
          // websocket still attached to the previous service. Only perform
          // the expensive credential flow when verification says the service
          // is genuinely absent or the browser token has expired.
          const restoreSession = hadPersistedSession
            ? verifyBrokerSession().then(() => null).catch(() => autoLoginBroker())
            : autoLoginBroker();

          // A user may log out or manually log in while recovery is pending,
          // so only apply a new token if this is still the startup session.
          void restoreSession
            .then((response) => {
              const current = get();
              if (response === null) {
                if (current.token === persistedToken) set({ sessionLive: true });
                return;
              }
              const startupSessionIsCurrent = hadPersistedSession
                ? current.token === persistedToken
                : !current.isAuthenticated;
              if (!startupSessionIsCurrent) return;

              set({
                token: response.access_token,
                user: response.user,
                isAuthenticated: true,
                error: null,
                tradingMode: response.user.trading_mode,
                sessionLive: true,
              });
            })
            .catch(() => {
              // A manual/custom session can still use the shell and show a
              // reconnect state. No startup error is needed here.
            });
        }
        return hydratePromise;
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
