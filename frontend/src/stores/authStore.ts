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

// hydrate() is called from every useAuth()-consuming component's mount
// effect (Header, DashboardLayout, and several pages all call it), and
// DashboardLayout is wrapped inside each page rather than a shared Next.js
// layout, so it fully remounts on every navigation. Without this cache,
// each of those mounts independently fires its own autoLoginBroker() call —
// on a server with no FYERS_* auto-login credentials configured, that's a
// burst of guaranteed-503 requests on every single page navigation. Caching
// the in-flight/completed promise means the real work runs once per page
// load; every caller just awaits the same result.
let hydratePromise: Promise<void> | null = null;

// Mirrors hydratePromise: once hydration has settled once this page load,
// every later DashboardLayout remount (see comment above) can skip straight
// to the real UI instead of flashing its full-screen spinner again — that
// spinner is driven by useAuth's local `hydrated` state, which otherwise
// resets to false on every fresh mount even though the actual work below
// only ever runs once.
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
        // See the module-level comment on hydratePromise — this must only
        // do its real work once per page load, no matter how many
        // components call it or how many times they remount.
        if (!hydratePromise) {
          hydratePromise = (async () => {
            // If a session is already persisted in localStorage, restore
            // it. Otherwise, silently try a server-side auto-login
            // (backend/.env credentials) before ever showing the login
            // form — falls back to the form if that isn't configured.
            const state = get();
            if (state.token && state.user) {
              set({ isAuthenticated: true });
              // Silently re-register the backend broker session in case the
              // server restarted or the in-memory session was lost.
              try {
                const response = await autoLoginBroker();
                set({
                  token: response.access_token,
                  user: response.user,
                  isAuthenticated: true,
                  error: null,
                  tradingMode: response.user.trading_mode,
                  sessionLive: true,
                });
              } catch {
                // Non-blocking catch for manual/custom sessions
              }
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
                sessionLive: true,
              });
            } catch {
              // No server-side credentials configured, or auto-login
              // failed — fall back to the manual login form.
            }
          })().finally(() => {
            hasHydratedOnce = true;
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
