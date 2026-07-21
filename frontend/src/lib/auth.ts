import { apiClient } from "./api";
import type { LoginRequest, LoginResponse, TradingMode } from "@/types/auth";

export async function loginWithBroker(request: LoginRequest): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>("/auth/login", request);
  return response.data;
}

/**
 * localStorage keys LoginForm uses to remember the last-used credentials for
 * convenience (not a session — the JWT in the auth store is the session).
 * Single source of truth so LoginForm and any manual-relogin affordance stay
 * in sync on key names.
 */
export const SAVED_LOGIN_KEYS = {
  loginType: "fy_login_type",
  appId: "fy_app_id",
  apiSecret: "fy_api_secret",
  clientId: "fy_client_id",
  totpSecret: "fy_totp_secret",
  pin: "fy_pin",
  redirectUri: "fy_redirect_uri",
  tradingMode: "fy_trading_mode",
} as const;

export interface SavedLoginCredentials {
  appId: string;
  apiSecret: string;
  clientId: string;
  totpSecret: string;
  pin: string;
  redirectUri: string;
  tradingMode: TradingMode;
}

export function getSavedLoginCredentials(): SavedLoginCredentials | null {
  if (typeof window === "undefined") return null;
  return {
    appId: localStorage.getItem(SAVED_LOGIN_KEYS.appId) || "",
    apiSecret: localStorage.getItem(SAVED_LOGIN_KEYS.apiSecret) || "",
    clientId: localStorage.getItem(SAVED_LOGIN_KEYS.clientId) || "",
    totpSecret: localStorage.getItem(SAVED_LOGIN_KEYS.totpSecret) || "",
    pin: localStorage.getItem(SAVED_LOGIN_KEYS.pin) || "",
    redirectUri: localStorage.getItem(SAVED_LOGIN_KEYS.redirectUri) || "http://127.0.0.1:3000",
    tradingMode: (localStorage.getItem(SAVED_LOGIN_KEYS.tradingMode) as TradingMode) || "paper",
  };
}

/** Whether enough saved fields exist to attempt a headless TOTP relogin. */
export function hasSavedTotpCredentials(): boolean {
  const c = getSavedLoginCredentials();
  return Boolean(c && c.appId && c.apiSecret && c.clientId && c.totpSecret && c.pin);
}

/** Clears remembered form fields — used when switching to a different account. */
export function clearSavedLoginCredentials(): void {
  if (typeof window === "undefined") return;
  Object.values(SAVED_LOGIN_KEYS).forEach((key) => localStorage.removeItem(key));
}

/**
 * Attempt a silent login using Fyers credentials configured server-side
 * (backend/.env). Throws if the backend has none configured or the login
 * fails — callers should treat that as "fall back to the manual form."
 */
export async function autoLoginBroker(): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>("/auth/auto-login");
  return response.data;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiClient.post("/auth/logout", {});
  } catch (e) {
    console.error("Logout request failed on backend", e);
  }
}
