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
  const { data } = await apiClient.get<AlertDeliverySettings>("/alerts/delivery-settings");
  return data;
}

export async function saveAlertDeliverySettings(settings: AlertDeliverySettingsUpdate): Promise<AlertDeliverySettings> {
  const { data } = await apiClient.put<AlertDeliverySettings>("/alerts/delivery-settings", settings);
  return data;
}
