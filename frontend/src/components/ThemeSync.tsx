"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/** Keeps <html>'s theme class in sync with the settings store after the
 * initial paint (see the blocking inline script in layout.tsx for the
 * pre-hydration flash-of-wrong-theme fix — this handles live toggling). */
export function ThemeSync() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
  }, [theme]);

  return null;
}
