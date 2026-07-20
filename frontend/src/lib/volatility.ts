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
  try {
    const response = await apiClient.get<VolatilityHistoricalData[]>(`/volatility/${symbol}/historical`);
    return response.data;
  } catch (e) {
    console.warn("Failed to fetch historical volatility from backend. Using mock fallback.", e);
    const mockData: VolatilityHistoricalData[] = [];
    const now = new Date();
    for (let i = 90; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const ivBase = 0.15 + Math.sin(i / 10) * 0.03;
      const rvBase = 0.14 + Math.cos(i / 12) * 0.02;
      mockData.push({
        date: date.toISOString().split("T")[0],
        rv: parseFloat((rvBase + Math.random() * 0.01).toFixed(4)),
        iv: parseFloat((ivBase + Math.random() * 0.015).toFixed(4)),
      });
    }
    return mockData;
  }
}

export async function getVolatilityMetrics(symbol: string): Promise<VolatilityMetrics> {
  try {
    const response = await apiClient.get<VolatilityMetrics>(`/volatility/${symbol}/metrics`);
    return response.data;
  } catch (e) {
    console.warn("Failed to fetch volatility metrics from backend. Using mock fallback.", e);
    return {
      symbol,
      current_iv: 0.165,
      iv_rank: 42,
      iv_percentile: 58,
      min_iv: 0.114,
      max_iv: 0.282,
      data_points: 252,
    };
  }
}
