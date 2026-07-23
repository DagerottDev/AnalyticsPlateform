import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Instrument } from "@/types/market";

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
  | "VWAP Breakout";
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
  addAlert: (alert: Omit<Alert, "id" | "status" | "createdAt">) => void;
  removeAlert: (id: string) => void;
  /** Called by the alert engine when a condition fires: logs the event, then either snoozes (cooldown > 0) or removes the (one-shot) alert. */
  recordTrigger: (id: string, value: number) => void;
  /** Called by the alert engine once a Snoozed alert's cooldown has elapsed. */
  rearmAlert: (id: string) => void;
  clearTriggerLog: () => void;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      alerts: [],
      triggerLog: [],

      addAlert: (alertData) => set((state) => ({
        alerts: [
          ...state.alerts,
          {
            ...alertData,
            id: Math.random().toString(36).substr(2, 9),
            status: "Active",
            createdAt: new Date().toISOString()
          }
        ]
      })),

      removeAlert: (id) => set((state) => ({
        alerts: state.alerts.filter(a => a.id !== id)
      })),

      recordTrigger: (id, value) => set((state) => {
        const alert = state.alerts.find(a => a.id === id);
        if (!alert) return state;

        const triggeredAt = new Date().toISOString();
        const event: AlertTriggerEvent = {
          id: Math.random().toString(36).substr(2, 9),
          alertId: alert.id,
          tradingSymbol: alert.instrument.trading_symbol,
          metric: alert.metric,
          operator: alert.operator,
          threshold: alert.threshold,
          value,
          triggeredAt,
        };

        const shouldRearm = alert.cooldownMinutes > 0;

        return {
          triggerLog: [event, ...state.triggerLog].slice(0, MAX_TRIGGER_LOG),
          alerts: shouldRearm
            ? state.alerts.map(a => a.id === id ? {
                ...a,
                status: "Snoozed" as const,
                triggeredAt,
                snoozedUntil: new Date(Date.now() + alert.cooldownMinutes * 60_000).toISOString(),
              } : a)
            : state.alerts.filter(a => a.id !== id),
        };
      }),

      rearmAlert: (id) => set((state) => ({
        alerts: state.alerts.map(a =>
          a.id === id ? { ...a, status: "Active" as const, snoozedUntil: undefined } : a
        )
      })),

      clearTriggerLog: () => set({ triggerLog: [] }),
    }),
    {
      name: "alert-storage",
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { alerts?: Array<Record<string, unknown>>; triggerLog?: unknown[] } | undefined;
        if (!state) return state;
        if (version < 2) {
          const alerts = Array.isArray(state.alerts) ? state.alerts : [];
          return {
            ...state,
            // Legacy one-shot "Triggered" alerts are now historical events, not live configs.
            alerts: alerts
              .filter((a) => a.status !== "Triggered")
              .map((a) => ({
                ...a,
                cooldownMinutes: (a.cooldownMinutes as number) ?? 0,
                status: a.status === "Disabled" ? "Disabled" : "Active",
              })),
            triggerLog: [],
          };
        }
        return state;
      },
    }
  )
);
