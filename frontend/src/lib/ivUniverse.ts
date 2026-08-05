import { apiClient } from "@/lib/api";

export interface IvUniverseSymbol {
  symbol: string;
  company_name: string;
  spot: number | null;
  /** Decimal IV, e.g. 0.18 means 18%. */
  atm_iv: number | null;
  iv_rank: number | null;
  iv_percentile: number | null;
  snapshot_date: string | null;
  updated_at: string | null;
  status: "building" | "ready" | "stale";
}

export interface IvUniverseResponse {
  symbols: IvUniverseSymbol[];
  generated_at: string;
}

export async function getIvUniverse(): Promise<IvUniverseResponse> {
  const response = await apiClient.get<IvUniverseResponse>("/volatility/universe");
  return response.data;
}
