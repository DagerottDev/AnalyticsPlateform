/**
 * Auth hook for consuming authentication state.
 *
 * Provides a clean interface over the Zustand auth store
 * with derived state like `canTrade`.
 */

import { useAuthStore } from "@/stores/authStore";
import type { TradingMode } from "@/types/auth";
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

  // Hydrate from localStorage on mount
  useEffect(() => {
    store.hydrate();
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (brokerName: string, appId: string, apiKey: string, accessToken: string, tradingMode: TradingMode) => {
      await store.login({ broker_name: brokerName, app_id: appId, api_key: apiKey, access_token: accessToken, trading_mode: tradingMode });
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
    setTradingMode: store.setTradingMode,
    clearError: store.clearError,
  };
}
