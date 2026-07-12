import { apiClient } from "./api";
import type { InstrumentResponse, ExpiryList } from "@/types/market";

export async function getInstruments(symbol: string): Promise<InstrumentResponse> {
  const response = await apiClient.get<InstrumentResponse>(`/market/instruments/${symbol}`);
  return response.data;
}

export async function getExpiries(symbol: string): Promise<ExpiryList> {
  const response = await apiClient.get<ExpiryList>(`/market/expiries/${symbol}`);
  return response.data;
}
