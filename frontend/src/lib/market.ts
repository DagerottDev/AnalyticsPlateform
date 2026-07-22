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
