import { apiClient } from "./api";

/** Mirrors the backend's actual response shape (backend/app/api/v1/volatility.py). */
export interface VolatilityHistoricalData {
  date: string;
  iv: number;
  rv: number;
}

/** Mirrors the backend's actual response shape (backend/app/api/v1/volatility.py). */
export interface VolatilityMetrics {
  symbol: string;
  current_iv: number;
  iv_rank: number;
  iv_percentile: number;
  min_iv: number;
  max_iv: number;
  data_points: number;
}

export async function getHistoricalVolatility(symbol: string): Promise<VolatilityHistoricalData[]> {
  const response = await apiClient.get<VolatilityHistoricalData[]>(`/volatility/${symbol}/historical`);
  return response.data;
}

export async function getVolatilityMetrics(symbol: string): Promise<VolatilityMetrics> {
  const response = await apiClient.get<VolatilityMetrics>(`/volatility/${symbol}/metrics`);
  return response.data;
}
