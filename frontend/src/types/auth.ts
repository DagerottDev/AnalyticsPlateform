/**
 * Authentication TypeScript type definitions.
 *
 * Shared types for auth state, API requests/responses,
 * and user profile across the frontend.
 */

/** Trading mode — paper (sandbox) or live (real money) */
export type TradingMode = "paper" | "live";

/** User profile from the backend */
export interface UserProfile {
  client_id: string;
  broker_name: string;
  trading_mode: TradingMode;
  account_name: string;
  connected_at: string;
}

/** Login request payload */
export interface LoginRequest {
  broker_name: string;
  app_id?: string;
  api_key?: string;
  access_token?: string;
  trading_mode: TradingMode;
}

/** Successful login response */
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

/** Token verification request */
export interface TokenVerifyRequest {
  token: string;
}

/** Token verification response */
export interface TokenVerifyResponse {
  valid: boolean;
  payload: Record<string, unknown> | null;
}

/** Auth store state */
export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  tradingMode: TradingMode;
}

/** Auth store actions */
export interface AuthActions {
  login: (request: LoginRequest) => Promise<void>;
  logout: () => void;
  setTradingMode: (mode: TradingMode) => void;
  clearError: () => void;
  hydrate: () => void;
}

/** Combined auth store type */
export type AuthStore = AuthState & AuthActions;
