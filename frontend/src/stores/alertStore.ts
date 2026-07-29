import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Instrument } from "@/types/market";
import {
  clearAlertEvents,
  createAlert as createAlertRequest,
  deleteAlert as deleteAlertRequest,
  fetchAlertEvents,
  fetchAlerts,
} from "@/lib/alerts";

export type AlertMetric =
  | "Price"
  | "IV"
  | "Delta"
  | "Gamma"
  | "Theta"
  | "Vega"
  | "Call GEX"
  | "Put GEX"
  | "Net GEX"
  | "VWAP Breakout"
  | "Rho"
  | "Vanna"
  | "Vomma"
  | "Charm"
  | "Speed"
  | "Color"
  | "Zomma"
  | "Ultima";
export type AlertOperator = ">" | "<" | ">=" | "<=";
export type AlertStatus = "Active" | "Snoozed" | "Disabled";

export interface Alert {
  id: string;
  instrument: Instrument;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  /** Minutes to wait before this alert can re-fire after triggering. 0 = fire once, then remove. */
  cooldownMinutes: number;
  status: AlertStatus;
  createdAt: string;
  triggeredAt?: string;
  /** Set while Snoozed; the alert auto-rearms to Active once this timestamp passes. */
  snoozedUntil?: string;
}

/** One historical firing of an alert — kept even after the alert itself rearms or is removed. */
export interface AlertTriggerEvent {
  id: string;
  alertId: string;
  tradingSymbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  value: number;
  triggeredAt: string;
}

const MAX_TRIGGER_LOG = 50;

interface AlertState {
  alerts: Alert[];
  triggerLog: AlertTriggerEvent[];
  /** Refresh the local cache from the durable server-side alert ledger. */
  refresh: () => Promise<void>;
  addAlert: (alert: Omit<Alert, "id" | "status" | "createdAt">) => Promise<void>;
  removeAlert: (id: string) => Promise<void>;
  clearTriggerLog: () => Promise<void>;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      alerts: [],
      triggerLog: [],

      refresh: async () => {
        const [alerts, triggerLog] = await Promise.all([fetchAlerts(), fetchAlertEvents()]);
        set({ alerts, triggerLog: triggerLog.slice(0, MAX_TRIGGER_LOG) });
      },

      addAlert: async (alertData) => {
        const alert = await createAlertRequest(alertData);
        set((state) => ({ alerts: [alert, ...state.alerts.filter(item => item.id !== alert.id)] }));
      },

      removeAlert: async (id) => {
        await deleteAlertRequest(id);
        set((state) => ({ alerts: state.alerts.filter(alert => alert.id !== id) }));
      },

      clearTriggerLog: async () => {
        await clearAlertEvents();
        set({ triggerLog: [] });
      },
    }),
    {
      name: "alert-storage",
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { alerts?: Array<Record<string, unknown>>; triggerLog?: unknown[] } | undefined;
        if (!state) return state;
        if (version < 3) {
          return {
            ...state,
            // Server data replaces this cache after authentication. Do not
            // recreate old local-only alerts, which would duplicate orders.
            alerts: [],
            triggerLog: [],
          };
        }
        return state;
      },
    }
  )
);
