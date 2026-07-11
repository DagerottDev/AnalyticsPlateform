import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Instrument } from "@/types/market";

export type AlertMetric = "Price" | "IV" | "Delta" | "Gamma" | "Theta" | "Vega" | "Call GEX" | "Put GEX" | "Net GEX";
export type AlertOperator = ">" | "<" | ">=" | "<=";

export interface Alert {
  id: string;
  instrument: Instrument;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  status: "Active" | "Triggered" | "Disabled";
  createdAt: string;
  triggeredAt?: string;
}

interface AlertState {
  alerts: Alert[];
  addAlert: (alert: Omit<Alert, "id" | "status" | "createdAt">) => void;
  removeAlert: (id: string) => void;
  updateAlertStatus: (id: string, status: Alert["status"], triggeredAt?: string) => void;
  clearTriggered: () => void;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      alerts: [],
      
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

      updateAlertStatus: (id, status, triggeredAt) => set((state) => ({
        alerts: state.alerts.map(a => 
          a.id === id 
            ? { ...a, status, triggeredAt: triggeredAt || a.triggeredAt } 
            : a
        )
      })),

      clearTriggered: () => set((state) => ({
        alerts: state.alerts.filter(a => a.status !== "Triggered")
      }))
    }),
    {
      name: "alert-storage"
    }
  )
);
