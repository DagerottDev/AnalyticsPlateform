import { create } from "zustand";
import { persist } from "zustand/middleware";
import { StrategyLeg } from "@/lib/strategy";

export type PositionStatus = "Open" | "Closed";

/** A paper position — a snapshot of Strategy Builder legs the user chose to "open" and track. */
export interface Position {
  id: string;
  symbol: string;
  label: string;
  legs: StrategyLeg[];
  /** Net premium paid (+) / received (-) across all legs at open, same sign convention as Strategy Builder's cost. */
  entryCost: number;
  status: PositionStatus;
  openedAt: string;
  closedAt?: string;
  /** Net mark value of all legs at close time (same sign convention as entryCost). */
  closeValue?: number;
  realizedPnl?: number;
}

interface PositionState {
  positions: Position[];
  addPosition: (position: Omit<Position, "id" | "status" | "openedAt">) => void;
  closePosition: (id: string, closeValue: number) => void;
  removePosition: (id: string) => void;
  clearClosed: () => void;
}

export const usePositionStore = create<PositionState>()(
  persist(
    (set) => ({
      positions: [],

      addPosition: (data) => set((state) => ({
        positions: [
          {
            ...data,
            id: Math.random().toString(36).substr(2, 9),
            status: "Open",
            openedAt: new Date().toISOString(),
          },
          ...state.positions,
        ]
      })),

      closePosition: (id, closeValue) => set((state) => ({
        positions: state.positions.map(p => p.id === id ? {
          ...p,
          status: "Closed" as const,
          closedAt: new Date().toISOString(),
          closeValue,
          realizedPnl: closeValue - p.entryCost,
        } : p)
      })),

      removePosition: (id) => set((state) => ({
        positions: state.positions.filter(p => p.id !== id)
      })),

      clearClosed: () => set((state) => ({
        positions: state.positions.filter(p => p.status !== "Closed")
      })),
    }),
    {
      name: "position-storage"
    }
  )
);
