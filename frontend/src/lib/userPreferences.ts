import { apiClient } from "@/lib/api";
import type { ServerUserPreferences, UserPreferences } from "@/stores/settingsStore";

export async function getUserPreferences(): Promise<ServerUserPreferences> {
  const { data } = await apiClient.get<ServerUserPreferences>("/settings");
  return data;
}

export async function saveUserPreferences(preferences: UserPreferences): Promise<ServerUserPreferences> {
  const { data } = await apiClient.put<ServerUserPreferences>("/settings", preferences);
  return data;
}

export async function resetUserPreferences(): Promise<ServerUserPreferences> {
  const { data } = await apiClient.delete<ServerUserPreferences>("/settings");
  return data;
}
