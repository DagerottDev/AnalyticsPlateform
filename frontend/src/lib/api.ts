import axios from "axios";

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
