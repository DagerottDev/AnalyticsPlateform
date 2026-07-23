import { apiClient } from "./api";
import type { InstrumentResponse, ExpiryList, MarketTick } from "@/types/market";

export async function getInstruments(symbol: string): Promise<InstrumentResponse> {
  const response = await apiClient.get<InstrumentResponse>(`/market/instruments/${symbol}`);
  return response.data;
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
