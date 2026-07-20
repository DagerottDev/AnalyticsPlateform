import { apiClient } from "./api";
import type { LoginRequest, LoginResponse } from "@/types/auth";

export async function loginWithBroker(request: LoginRequest): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>("/auth/login", request);
  return response.data;
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
