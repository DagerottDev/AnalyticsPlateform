import { apiClient } from "@/lib/api";

export interface AlertDeliverySettings {
  emailEnabled: boolean;
  emailRecipient: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  telegramEnabled: boolean;
  telegramBotTokenConfigured: boolean;
  telegramChatId: string | null;
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
}

export interface AlertDeliverySettingsUpdate extends Omit<AlertDeliverySettings, "telegramBotTokenConfigured"> {
  telegramBotToken?: string;
}

export async function getAlertDeliverySettings(): Promise<AlertDeliverySettings> {
  // Settings should never leave the page in an indeterminate loading state if
  // the API or database is unavailable. The caller turns this timeout into a
  // visible error with a retry action.
  const { data } = await apiClient.get<AlertDeliverySettings>("/alerts/delivery-settings", { timeout: 10_000 });
  return data;
}

export async function saveAlertDeliverySettings(settings: AlertDeliverySettingsUpdate): Promise<AlertDeliverySettings> {
  const { data } = await apiClient.put<AlertDeliverySettings>("/alerts/delivery-settings", settings, { timeout: 10_000 });
  return data;
}
