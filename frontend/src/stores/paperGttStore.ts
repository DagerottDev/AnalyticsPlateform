import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Instrument } from "@/types/market";

export interface PaperGtt { id: string; symbol: string; instrument: Instrument; side: "Buy" | "Sell"; quantity: number; triggerPrice: number; executionType: "MARKET" | "LIMIT"; limitPrice: number; expiresAt: string; status: "Pending" | "Placed" | "Expired" | "Cancelled"; }
interface PaperGttState { orders: PaperGtt[]; add: (order: Omit<PaperGtt, "id" | "status">) => void; finish: (id: string, status: PaperGtt["status"]) => void; }
export const usePaperGttStore = create<PaperGttState>()(persist((set) => ({
  orders: [],
  add: (order) => set((state) => ({ orders: [{ ...order, id: `paper-gtt-${Date.now()}`, status: "Pending" }, ...state.orders] })),
  finish: (id, status) => set((state) => ({ orders: state.orders.map((order) => order.id === id ? { ...order, status } : order) })),
}), { name: "paper-gtt-storage" }));
