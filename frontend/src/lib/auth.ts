import { apiClient } from "./api";
import type { LoginRequest, LoginResponse } from "@/types/auth";

export async function loginWithBroker(request: LoginRequest): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>("/auth/login", request);
  return response.data;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiClient.post("/auth/logout", {});
  } catch (e) {
    console.error("Logout request failed on backend", e);
  }
}
