import { apiClient } from "./api";
import type { InstrumentResponse, ExpiryList, MarketTick, SymbolSuggestion } from "@/types/market";

export async function getInstruments(symbol: string): Promise<InstrumentResponse> {
  const response = await apiClient.get<InstrumentResponse>(`/market/instruments/${symbol}`);
  return response.data;
}

/** Autocomplete matches for the "Or Stock Symbol" field (static NSE F&O list, see backend). */
export async function searchSymbols(query: string): Promise<SymbolSuggestion[]> {
  const response = await apiClient.get<{ matches: SymbolSuggestion[] }>("/market/symbols/search", {
    params: { q: query },
  });
  return response.data.matches;
}

export async function getExpiries(symbol: string): Promise<ExpiryList> {
  const response = await apiClient.get<ExpiryList>(`/market/expiries/${symbol}`);
  return response.data;
}

export async function getMarketQuotes(symbols: string[]): Promise<{ quotes: MarketTick[] }> {
  if (symbols.length === 0) return { quotes: [] };
  const response = await apiClient.get<{ quotes: MarketTick[] }>(
    `/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`
  );
  return response.data;
}

export interface MarginOrderLeg {
  symbol: string;
  quantity: number;
  side: "Buy" | "Sell";
  product_type?: string;
}

export interface MarginResult {
  total_margin: number | null;
  available_margin: number | null;
  span_margin: number | null;
  exposure_margin: number | null;
  premium: number | null;
  raw: Record<string, unknown>;
}

/** Margin required to take a prospective basket of positions — hits Fyers'
 * live margin calculator, no order is placed. */
export async function getMarginRequirement(legs: MarginOrderLeg[]): Promise<MarginResult> {
  const response = await apiClient.post<MarginResult>("/market/margin", { legs });
  return response.data;
}

/** Mirrors the backend's actual response shape (backend/app/services/fyers_service.py get_historical_data). */
export interface HistoricalCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  open_interest: number;
}

export interface OpenInterestSnapshot {
  timestamp: string;
  total_call_oi: number;
  total_put_oi: number;
  total_call_change: number;
  total_put_change: number;
}

export interface OpenInterestHistoryResponse {
  symbol: string;
  expiry: string;
  session_date: string | null;
  points: OpenInterestSnapshot[];
  baseline: string;
  scheduled_tracking: boolean;
}

export async function getOpenInterestHistory(symbol: string, expiry: string): Promise<OpenInterestHistoryResponse> {
  const response = await apiClient.get<OpenInterestHistoryResponse>("/market/open-interest/history", {
    params: { symbol, expiry },
  });
  return response.data;
}

/**
 * OHLCV candles already persisted by the market-data backfill job.  Unlike
 * getHistoricalCandles(), this does not make a broker request, which makes it
 * suitable for multi-month backtests and repeatable analysis.
 */
export async function getStoredHistoricalCandles(
  symbol: string,
  start: string,
  end: string,
  limit: number = 5000
): Promise<HistoricalCandle[]> {
  const response = await apiClient.get<HistoricalCandle[]>(
    `/historical/ohlcv/${encodeURIComponent(symbol)}`,
    { params: { start: new Date(`${start}T00:00:00`).toISOString(), end: new Date(`${end}T23:59:59.999`).toISOString(), limit } }
  );
  return response.data;
}

/** Real historical OHLCV candles pulled live from the broker (see GET /market/history). */
export async function getHistoricalCandles(
  symbol: string,
  rangeFrom: string,
  rangeTo: string,
  resolution: string = "1"
): Promise<HistoricalCandle[]> {
  const response = await apiClient.get<{ candles: HistoricalCandle[] }>("/market/history", {
    params: { symbol, range_from: rangeFrom, range_to: rangeTo, resolution },
  });
  return response.data.candles;
}
