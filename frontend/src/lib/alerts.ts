import { apiClient } from "@/lib/api";
import type { Alert, AlertTriggerEvent } from "@/stores/alertStore";

type NewAlert = Omit<Alert, "id" | "status" | "createdAt">;

export async function fetchAlerts(): Promise<Alert[]> {
  const { data } = await apiClient.get<Alert[]>("/alerts");
  return data;
}

export async function createAlert(alert: NewAlert): Promise<Alert> {
  const { data } = await apiClient.post<Alert>("/alerts", alert);
  return data;
}

export async function deleteAlert(id: string): Promise<void> {
  await apiClient.delete(`/alerts/${id}`);
}

export async function fetchAlertEvents(): Promise<AlertTriggerEvent[]> {
  const { data } = await apiClient.get<AlertTriggerEvent[]>("/alerts/events");
  return data;
}

export async function clearAlertEvents(): Promise<void> {
  await apiClient.delete("/alerts/events");
}
