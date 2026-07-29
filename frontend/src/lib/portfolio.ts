import { apiClient } from "./api";

/** Mirrors the backend's actual response shape (backend/app/schemas/portfolio.py). */
export interface BrokerPosition {
  trading_symbol: string;
  symbol: string;
  product_type: string;
  quantity: number;
  side: "Buy" | "Sell" | "Flat";
  avg_price: number;
  last_price: number;
  realized_pnl: number;
  unrealized_pnl: number;
  pnl: number;
}

export interface PositionsResponse {
  positions: BrokerPosition[];
  total_pnl: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
}

export interface BrokerHolding {
  trading_symbol: string;
  symbol: string;
  holding_type: string;
  quantity: number;
  avg_price: number;
  last_price: number;
  market_value: number;
  pnl: number;
}

export interface HoldingsResponse {
  holdings: BrokerHolding[];
  total_market_value: number;
  total_pnl: number;
}

export interface FundsResponse {
  total_balance: number | null;
  available_balance: number | null;
  utilized_amount: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  raw: Record<string, unknown>[];
}

/** Real broker positions (intraday + carry-forward), live from the connected Fyers account. */
export async function getBrokerPositions(): Promise<PositionsResponse> {
  const response = await apiClient.get<PositionsResponse>("/portfolio/positions");
  return response.data;
}

/** Real delivery/long-term holdings, live from the connected Fyers account. */
export async function getBrokerHoldings(): Promise<HoldingsResponse> {
  const response = await apiClient.get<HoldingsResponse>("/portfolio/holdings");
  return response.data;
}

/** Real account funds/margin summary, live from the connected Fyers account. */
export async function getBrokerFunds(): Promise<FundsResponse> {
  const response = await apiClient.get<FundsResponse>("/portfolio/funds");
  return response.data;
}
