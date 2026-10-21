import { apiClient } from "./api";
import type { BrokerName, LoginRequest, LoginResponse, TradingMode } from "@/types/auth";

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
  broker: "broker_name",
  loginType: "fy_login_type",
  appId: "fy_app_id",
  apiSecret: "fy_api_secret",
  clientId: "fy_client_id",
  totpSecret: "fy_totp_secret",
  pin: "fy_pin",
  redirectUri: "fy_redirect_uri",
  tradingMode: "fy_trading_mode",
  dhanAccessToken: "dhan_access_token",
} as const;

export interface SavedLoginCredentials {
  broker: BrokerName;
  appId: string;
  apiSecret: string;
  clientId: string;
  totpSecret: string;
  pin: string;
  redirectUri: string;
  tradingMode: TradingMode;
  dhanAccessToken: string;
}

export function getSavedLoginCredentials(): SavedLoginCredentials | null {
  if (typeof window === "undefined") return null;
  return {
    broker: (localStorage.getItem(SAVED_LOGIN_KEYS.broker) as BrokerName) || "fyers",
    appId: localStorage.getItem(SAVED_LOGIN_KEYS.appId) || "",
    apiSecret: localStorage.getItem(SAVED_LOGIN_KEYS.apiSecret) || "",
    clientId: localStorage.getItem(SAVED_LOGIN_KEYS.clientId) || "",
    totpSecret: localStorage.getItem(SAVED_LOGIN_KEYS.totpSecret) || "",
    pin: localStorage.getItem(SAVED_LOGIN_KEYS.pin) || "",
    redirectUri: localStorage.getItem(SAVED_LOGIN_KEYS.redirectUri) || "http://127.0.0.1:3000",
    tradingMode: (localStorage.getItem(SAVED_LOGIN_KEYS.tradingMode) as TradingMode) || "paper",
    dhanAccessToken: localStorage.getItem(SAVED_LOGIN_KEYS.dhanAccessToken) || "",
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
 * Recover the same broker account using an existing, unexpired browser session.
 */
export async function autoLoginBroker(token: string): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>("/auth/auto-login", {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

/** Verify the backend-restored broker service without replacing it. */
export async function verifyBrokerSession(token: string): Promise<void> {
  await apiClient.get("/auth/session", { headers: { Authorization: `Bearer ${token}` } });
}

export async function logoutUser(token: string | null): Promise<void> {
  try {
    await apiClient.post("/auth/logout", {}, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
  } catch (e) {
    console.error("Logout request failed on backend", e);
  }
}
