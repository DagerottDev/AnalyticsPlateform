import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";

interface SettingsDefaults {
  theme: ThemeMode;
  defaultSymbol: string;
  notifyToast: boolean;
  notifyDesktop: boolean;
}

const DEFAULTS: SettingsDefaults = {
  theme: "dark",
  defaultSymbol: "NIFTY",
  notifyToast: true,
  notifyDesktop: false,
};

interface SettingsState extends SettingsDefaults {
  setTheme: (theme: ThemeMode) => void;
  setDefaultSymbol: (symbol: string) => void;
  setNotifyToast: (enabled: boolean) => void;
  setNotifyDesktop: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setTheme: (theme) => set({ theme }),
      setDefaultSymbol: (symbol) => set({ defaultSymbol: symbol.trim().toUpperCase() || DEFAULTS.defaultSymbol }),
      setNotifyToast: (notifyToast) => set({ notifyToast }),
      setNotifyDesktop: (notifyDesktop) => set({ notifyDesktop }),
      resetToDefaults: () => set(DEFAULTS),
    }),
    {
      name: "settings-storage"
    }
  )
);
