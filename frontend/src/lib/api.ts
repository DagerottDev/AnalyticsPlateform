import axios from "axios";
import { useApiErrorLogStore } from "@/stores/apiErrorLogStore";
import { formatApiError } from "@/lib/apiError";

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
          if (state?.token) {
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

// Log every failed request so it can be reviewed/copied from the API error
// log panel, regardless of whether the calling page shows its own inline error.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const method = (error?.config?.method || "GET").toUpperCase();
    const url = error?.config?.url || "unknown";
    const status: number | null = error?.response?.status ?? null;
    const message =
      error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Request failed";

    useApiErrorLogStore.getState().logError({ method, url, status, message, detail: formatApiError(error) });

    return Promise.reject(error);
  }
);
