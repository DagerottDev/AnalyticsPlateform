import { apiClient } from "@/lib/api";

export interface JournalTrade { id: string; trading_symbol: string; side: "Buy" | "Sell"; quantity: number; entry_price: number; exit_price: number | null; stop_price: number | null; entry_time: string; exit_time: string | null; notes: string; tags: string[]; source: "manual" | "paper" | "fyers"; pnl: number | null; risk_reward: number | null; created_at: string; updated_at: string; }
export interface JournalSummary { closed_trades: number; win_rate: number | null; average_risk_reward: number | null; net_pnl: number; equity_curve: { date: string; equity: number }[]; }
export interface TradeInput { trading_symbol: string; side: "Buy" | "Sell"; quantity: number; entry_price: number; exit_price?: number | null; stop_price?: number | null; entry_time: string; exit_time?: string | null; notes: string; tags: string[]; source: "manual" | "paper" | "fyers"; }
export const getJournalTrades = async () => (await apiClient.get<JournalTrade[]>("/journal/trades")).data;
export const getJournalSummary = async () => (await apiClient.get<JournalSummary>("/journal/summary")).data;
export const createJournalTrade = async (trade: TradeInput) => (await apiClient.post<JournalTrade>("/journal/trades", trade)).data;
