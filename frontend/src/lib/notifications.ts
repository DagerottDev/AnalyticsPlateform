/** Thin wrapper around the browser Notification API — desktop alerts for
 * when the app tab isn't focused. All calls are no-ops in unsupported
 * environments (SSR, older browsers) rather than throwing. */

export function isDesktopNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission {
  return isDesktopNotificationSupported() ? Notification.permission : "denied";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isDesktopNotificationSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function sendDesktopNotification(title: string, body: string): void {
  if (!isDesktopNotificationSupported() || Notification.permission !== "granted") return;
  new Notification(title, { body });
}
