/**
 * Authentication TypeScript type definitions.
 *
 * Shared types for auth state, API requests/responses, and user profile
 * across the frontend. Fyers is the only supported broker, and only one
 * broker session is active at a time.
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

/**
 * Login request payload.
 *
 * Provide exactly one auth method:
 * - OAuth redirect: `auth_code`
 * - Headless TOTP auto-login: `client_id` + `totp_secret` + `pin`
 */
export interface LoginRequest {
  app_id: string;
  api_secret: string;
  redirect_uri?: string;
  trading_mode: TradingMode;

  // OAuth redirect flow
  auth_code?: string;

  // Headless TOTP auto-login flow
  client_id?: string;
  totp_secret?: string;
  pin?: string;
}

/** Successful login response */
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

/** Auth store state */
export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: unknown | null;
  tradingMode: TradingMode;
  /**
   * Whether the backend broker session backing this token is actually
   * still alive. Starts true (optimistic) and is flipped false by the API
   * client when a request comes back 401 "Active broker session not
   * found" and silent recovery fails — e.g. after a backend restart wipes
   * its in-memory session. Distinct from `isAuthenticated`, which only
   * reflects whether we have a persisted token/user at all.
   */
  sessionLive: boolean;
}

/** Auth store actions */
export interface AuthActions {
  login: (request: LoginRequest) => Promise<void>;
  logout: () => void;
  setTradingMode: (mode: TradingMode) => void;
  updateAccountName: (name: string) => void;
  clearError: () => void;
  hydrate: () => Promise<void>;
  setSessionLive: (live: boolean) => void;
}

/** Combined auth store type */
export type AuthStore = AuthState & AuthActions;
