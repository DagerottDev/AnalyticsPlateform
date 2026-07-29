import { apiClient } from "@/lib/api";

export interface RelativeValueInstrument {
  symbol: string;
  spot?: number;
  change_percent?: number;
  expiry?: string;
  /** Decimal IV, e.g. 0.18 means 18%. */
  atm_iv?: number;
  put_iv?: number | null;
  call_iv?: number | null;
  /** Put OTM IV minus call OTM IV, in decimal IV units. */
  skew?: number | null;
  net_gex?: number;
  iv_rank?: number | null;
  gex_model?: string;
  error?: string;
}

export interface RelativeValueResponse {
  comparisons: RelativeValueInstrument[];
  generated_at: string;
}

export async function getRelativeValueComparison(symbols: string[]): Promise<RelativeValueResponse> {
  const response = await apiClient.get<RelativeValueResponse>("/volatility/compare", {
    params: { symbols: symbols.join(",") },
  });
  return response.data;
}
