import { create } from "zustand";
import { persist } from "zustand/middleware";
import { StrategyLeg } from "@/lib/strategy";
import { PaperFill } from "@/lib/paperTrading";

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
  /** All Strategy Builder positions are simulated orders, never broker orders. */
  mode: "paper";
  /** Per-leg open fills captured at the instant the paper order was placed. */
  fills: PaperFill[];
}

type NewPaperPosition = Omit<Position, "id" | "status" | "openedAt" | "mode">;

interface PositionState {
  positions: Position[];
  executePaperOrder: (position: NewPaperPosition) => void;
  closePosition: (id: string, closeValue: number) => void;
  removePosition: (id: string) => void;
  clearClosed: () => void;
}

export const usePositionStore = create<PositionState>()(
  persist(
    (set) => ({
      positions: [],

      executePaperOrder: (data) => set((state) => ({
        positions: [
          {
            ...data,
            id: Math.random().toString(36).substr(2, 9),
            status: "Open",
            openedAt: new Date().toISOString(),
            mode: "paper",
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
      name: "position-storage",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<PositionState>;
        return {
          ...state,
          positions: (state.positions || []).map((position) => ({
            ...position,
            mode: "paper" as const,
            fills: position.fills || [],
          })),
        };
      },
    }
  )
);
