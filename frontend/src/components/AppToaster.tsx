"use client";

import { Toaster } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";

export function AppToaster() {
  const theme = useSettingsStore((state) => state.theme);
  return <Toaster theme={theme} position="bottom-right" richColors />;
}
