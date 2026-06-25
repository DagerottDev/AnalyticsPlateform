"use client";

import { useAlertEngine } from "@/hooks/useAlertEngine";

/**
 * A dummy component that mounts the useAlertEngine hook.
 * We mount this in the RootLayout so that alerts are evaluated globally
 * regardless of which page the user is currently viewing.
 */
export function AlertEngineMount() {
  useAlertEngine();
  return null;
}
