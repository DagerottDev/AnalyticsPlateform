/**
 * Auth hook for consuming authentication state.
 *
 * Provides a clean interface over the Zustand auth store
 * with derived state like `canTrade`.
 */

import { useAuthStore } from "@/stores/authStore";
import type { LoginRequest, TradingMode } from "@/types/auth";
import { useCallback, useEffect, useState } from "react";

/**
 * Hook for authentication state and actions.
 *
 * @example
 * ```tsx
 * const { user, isAuthenticated, login, logout } = useAuth();
 * ```
 */
export function useAuth() {
  const store = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  // Restore session from localStorage, or silently attempt a server-side
  // auto-login, before revealing the login form.
  useEffect(() => {
    let cancelled = false;
    store.hydrate().finally(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (request: LoginRequest) => {
      await store.login(request);
    },
    [store]
  );

  return {
    // State
    user: store.user,
    token: store.token,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    error: store.error,
    tradingMode: store.tradingMode,
    hydrated,

    // Derived
    canTrade: store.isAuthenticated && store.tradingMode === "live",
    isPaperMode: store.tradingMode === "paper",
    brokerName: store.user?.broker_name || "Not Connected",

    // Actions
    login,
    logout: store.logout,
    setTradingMode: store.setTradingMode as (mode: TradingMode) => void,
    updateAccountName: store.updateAccountName,
    clearError: store.clearError,
  };
}
