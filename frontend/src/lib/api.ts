import axios from "axios";
import { useApiErrorLogStore } from "@/stores/apiErrorLogStore";
import { formatApiError } from "@/lib/apiError";
import { useAuthStore } from "@/stores/authStore";
import type { LoginResponse } from "@/types/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_URL_WITH_VERSION = API_BASE_URL.endsWith("/api/v1") 
  ? API_BASE_URL 
  : `${API_BASE_URL.replace(/\/api$/, "")}/api/v1`;

export const apiClient = axios.create({
  baseURL: API_URL_WITH_VERSION,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add a request interceptor to automatically add authorization header
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const authStorage = localStorage.getItem("auth-storage");
      if (authStorage) {
        try {
          const { state } = JSON.parse(authStorage);
          if (state?.token && !config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${state.token}`;
          }
        } catch (e) {
          console.error("Failed to parse token from localStorage", e);
        }
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Endpoints whose failures are deliberately probed-and-ignored by the
// caller (see authStore.ts's hydrate(), which always wraps this in a
// non-blocking .catch()) — logging them would just be permanent noise in
// the failure panel for something that isn't actually a problem.
const SILENT_FAILURE_URLS = ["/auth/auto-login", "/auth/session"];

// The backend's broker session lives in an in-memory map keyed by client_id
// and doesn't survive a server restart, independently of the browser's own
// JWT (which is still valid). "Active broker session not found" is the
// signature of that specific failure — see session_manager.get_session().
const SESSION_LOST_DETAIL = "Active broker session not found";

// Recovery calls are deduped: if several requests 401 with a lost session at
// once, they all await the same in-flight auto-login rather than each
// triggering their own.
let sessionRecovery: { token: string; promise: Promise<LoginResponse> } | null = null;

function recoverBrokerSession(token: string): Promise<LoginResponse> {
  if (!sessionRecovery || sessionRecovery.token !== token) {
    const promise = apiClient
      .post<LoginResponse>("/auth/auto-login", {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => res.data)
      .finally(() => {
        if (sessionRecovery?.promise === promise) sessionRecovery = null;
      });
    sessionRecovery = { token, promise };
  }
  return sessionRecovery.promise;
}

// Log every failed request so it can be reviewed/copied from the API error
// log panel, regardless of whether the calling page shows its own inline error.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const url = error?.config?.url || "unknown";
    const status: number | null = error?.response?.status ?? null;
    const detail = error?.response?.data?.detail;
    const session = useAuthStore.getState();
    const requestToken = error.config?.headers?.Authorization;

    // Try one silent recovery before surfacing the failure — mirrors what
    // authStore.hydrate() does on app mount, but reacts to the session
    // being lost mid-session instead of only at page load.
    if (
      status === 401 &&
      detail === SESSION_LOST_DETAIL &&
      session.token && session.user && session.isAuthenticated && !session.isLoading &&
      requestToken === `Bearer ${session.token}` &&
      !url.includes("/auth/") &&
      !error.config?.__sessionRecoveryAttempted
    ) {
      error.config.__sessionRecoveryAttempted = true;
      try {
        const recovered = await recoverBrokerSession(session.token);
        const current = useAuthStore.getState();
        if (
          !current.isAuthenticated || current.isLoading ||
          (current.token !== session.token && current.token !== recovered.access_token) ||
          recovered.user.client_id !== session.user.client_id ||
          recovered.user.broker_name.toLowerCase() !== session.user.broker_name.toLowerCase() ||
          recovered.user.trading_mode !== session.user.trading_mode
        ) return Promise.reject(error);
        useAuthStore.setState({
          token: recovered.access_token,
          user: recovered.user,
          isAuthenticated: true,
          error: null,
          tradingMode: recovered.user.trading_mode,
          sessionLive: true,
        });
        error.config.headers = {
          ...error.config.headers,
          Authorization: `Bearer ${recovered.access_token}`,
        };
        return apiClient.request(error.config);
      } catch {
        // No server-side auto-login credentials configured, or recovery
        // failed — the session is genuinely gone until the user relogins.
        const current = useAuthStore.getState();
        if (current.token === session.token && !current.isLoading) {
          useAuthStore.setState({ sessionLive: false });
        }
      }
    }

    if (SILENT_FAILURE_URLS.some((silentUrl) => url.includes(silentUrl))) {
      return Promise.reject(error);
    }

    const method = (error?.config?.method || "GET").toUpperCase();
    const message =
      error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Request failed";

    useApiErrorLogStore.getState().logError({ method, url, status, message, detail: formatApiError(error) });

    return Promise.reject(error);
  }
);
