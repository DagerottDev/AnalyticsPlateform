import { create } from "zustand";
import { persist } from "zustand/middleware";
import { StrategyLeg } from "@/lib/strategy";
import { PaperFill } from "@/lib/paperTrading";

export type PositionStatus = "Open" | "Closed";

export interface PaperLegExit {
  price: number;
  reason: string;
  closedAt: string;
}

export interface PaperBasketRisk {
  legRisk: Record<string, { stopLoss?: number; targetPrice?: number }>;
  combinedStopLoss?: number;
  combinedTarget?: number;
}

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
  /** Optional protection configured by the Option Chain basket ticket. */
  basketRisk?: PaperBasketRisk;
  /** A basket leg can close before the rest of the paper strategy. */
  legExits?: Record<string, PaperLegExit>;
}

type NewPaperPosition = Omit<Position, "id" | "status" | "openedAt" | "mode">;

interface PositionState {
  positions: Position[];
  executePaperOrder: (position: NewPaperPosition) => void;
  closePosition: (id: string, closeValue: number) => void;
  settleBasketLeg: (id: string, legId: string, price: number, reason: string) => void;
  settleBasket: (id: string, prices: Record<string, number>, reason: string) => void;
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

      settleBasketLeg: (id, legId, price, reason) => set((state) => ({
        positions: state.positions.map(position => {
          if (position.id !== id || position.status === "Closed" || position.legExits?.[legId]) return position;
          const legExits = {
            ...(position.legExits || {}),
            [legId]: { price, reason, closedAt: new Date().toISOString() },
          };
          const allClosed = position.legs.every(leg => Boolean(legExits[leg.id]));
          const closeValue = allClosed ? position.legs.reduce((sum, leg) => {
            const exit = legExits[leg.id];
            return sum + exit.price * leg.quantity * (leg.action === "Buy" ? 1 : -1);
          }, 0) : undefined;
          return allClosed ? {
            ...position, legExits, status: "Closed" as const, closedAt: new Date().toISOString(),
            closeValue, realizedPnl: closeValue! - position.entryCost,
          } : { ...position, legExits };
        }),
      })),

      settleBasket: (id, prices, reason) => set((state) => ({
        positions: state.positions.map(position => {
          if (position.id !== id || position.status === "Closed") return position;
          const legExits = { ...(position.legExits || {}) };
          position.legs.forEach(leg => {
            if (!legExits[leg.id] && Number.isFinite(prices[leg.id]) && prices[leg.id] > 0) {
              legExits[leg.id] = { price: prices[leg.id], reason, closedAt: new Date().toISOString() };
            }
          });
          if (!position.legs.every(leg => Boolean(legExits[leg.id]))) return { ...position, legExits };
          const closeValue = position.legs.reduce((sum, leg) => (
            sum + legExits[leg.id].price * leg.quantity * (leg.action === "Buy" ? 1 : -1)
          ), 0);
          return {
            ...position, legExits, status: "Closed" as const, closedAt: new Date().toISOString(),
            closeValue, realizedPnl: closeValue - position.entryCost,
          };
        }),
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
            basketRisk: position.basketRisk || undefined,
            legExits: position.legExits || {},
          })),
        };
      },
    }
  )
);
