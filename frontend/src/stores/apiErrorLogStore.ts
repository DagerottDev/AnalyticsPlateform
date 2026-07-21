import { create } from "zustand";

export interface ApiErrorLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number | null;
  message: string;
  detail: string;
}

interface ApiErrorLogState {
  errors: ApiErrorLogEntry[];
  logError: (entry: Omit<ApiErrorLogEntry, "id" | "timestamp">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

// Failures accumulate for the whole session (not persisted) so navigating
// between pages doesn't lose the log — only capped to avoid unbounded growth.
const MAX_ENTRIES = 50;

export const useApiErrorLogStore = create<ApiErrorLogState>((set) => ({
  errors: [],

  logError: (entry) =>
    set((state) => ({
      errors: [
        {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
        },
        ...state.errors,
      ].slice(0, MAX_ENTRIES),
    })),

  dismiss: (id) => set((state) => ({ errors: state.errors.filter((e) => e.id !== id) })),

  clear: () => set({ errors: [] }),
}));
