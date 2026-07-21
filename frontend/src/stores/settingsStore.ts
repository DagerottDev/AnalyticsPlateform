import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  showMockDataOnFailure: boolean;
  setShowMockDataOnFailure: (value: boolean) => void;
}

// Defaults to false: a failed request should surface as a visible error,
// not silently render fabricated placeholder data that looks real.
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      showMockDataOnFailure: false,
      setShowMockDataOnFailure: (value) => set({ showMockDataOnFailure: value }),
    }),
    { name: "settings-storage" }
  )
);
