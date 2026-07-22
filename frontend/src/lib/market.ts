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
