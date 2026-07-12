import { apiClient } from "./api";

export interface VolatilityHistoricalData {
  date: string;
  historicalVolatility: number;
  impliedVolatility: number;
}

export interface VolatilityMetrics {
  ivRank: number;
  ivPercentile: number;
  currentIv: number;
  ivHigh365d: number;
  ivLow365d: number;
}

export async function getHistoricalVolatility(symbol: string): Promise<VolatilityHistoricalData[]> {
  try {
    const response = await apiClient.get<VolatilityHistoricalData[]>(`/volatility/historical/${symbol}`);
    return response.data;
  } catch (e) {
    console.warn("Failed to fetch historical volatility from backend. Using mock fallback.", e);
    const mockData: VolatilityHistoricalData[] = [];
    const now = new Date();
    for (let i = 90; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const ivBase = 15 + Math.sin(i / 10) * 3;
      const rvBase = 14 + Math.cos(i / 12) * 2;
      mockData.push({
        date: date.toISOString().split("T")[0],
        historicalVolatility: parseFloat((rvBase + Math.random()).toFixed(2)),
        impliedVolatility: parseFloat((ivBase + Math.random() * 1.5).toFixed(2)),
      });
    }
    return mockData;
  }
}

export async function getVolatilityMetrics(symbol: string): Promise<VolatilityMetrics> {
  try {
    const response = await apiClient.get<VolatilityMetrics>(`/volatility/metrics/${symbol}`);
    return response.data;
  } catch (e) {
    console.warn("Failed to fetch volatility metrics from backend. Using mock fallback.", e);
    return {
      ivRank: 42,
      ivPercentile: 58,
      currentIv: 16.5,
      ivHigh365d: 28.2,
      ivLow365d: 11.4,
    };
  }
}
