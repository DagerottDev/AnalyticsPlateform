"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAlertStore } from "@/stores/alertStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { sendDesktopNotification } from "@/lib/notifications";
import { useAuthStore } from "@/stores/authStore";

export function useAlertEngine() {
  const triggerLog = useAlertStore((state) => state.triggerLog);
  const refresh = useAlertStore((state) => state.refresh);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const notifyToast = useSettingsStore((state) => state.notifyToast);
  const notifyDesktop = useSettingsStore((state) => state.notifyDesktop);
  const seenEvents = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refresh()
      .then(() => {
        initialized.current = true;
        useAlertStore.getState().triggerLog.forEach(event => seenEvents.current.add(event.id));
      })
      .catch(() => {});
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    if (!initialized.current) return;
    triggerLog.forEach(event => {
      if (seenEvents.current.has(event.id)) return;
      seenEvents.current.add(event.id);
      const title = `Alert Triggered: ${event.tradingSymbol}`;
      const description = `${event.metric} ${event.operator} ${event.threshold} (Current: ${event.value.toFixed(4)})`;
      if (notifyToast) toast.success(title, { description, duration: 10_000 });
      if (notifyDesktop) sendDesktopNotification(title, description);
    });
  }, [triggerLog, notifyToast, notifyDesktop]);

  return null; // This is a logic-only component
}
