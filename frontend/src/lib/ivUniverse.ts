import { apiClient } from "@/lib/api";

export type CorporateCalendarStatus = "ready" | "stale" | "unavailable";
export type CorporateEventType = "results" | "board_meeting" | "dividend" | "split" | "bonus" | "buyback" | "rights";
export type CorporateEventDateKind = "meeting_date" | "ex_date" | "record_date";

export interface CorporateCalendarEvent {
  event_type: CorporateEventType;
  title: string;
  event_date: string;
  date_kind: CorporateEventDateKind;
  source: "NSE";
}

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
  events: CorporateCalendarEvent[];
}

export interface IvUniverseResponse {
  symbols: IvUniverseSymbol[];
  generated_at: string;
  corporate_calendar: { status: CorporateCalendarStatus; updated_at: string | null };
}

export interface IvExpectedRange {
  move: number;
  lower: number;
  upper: number;
}

export function expectedIvRange(
  spot: number | null | undefined,
  atmIv: number | null | undefined,
  projectionDays: number,
  sigma: number
): IvExpectedRange | null {
  if (spot === null || spot === undefined || atmIv === null || atmIv === undefined || spot <= 0 || atmIv < 0) {
    return null;
  }
  const days = Math.min(60, Math.max(1, Math.trunc(projectionDays)));
  const move = spot * atmIv * sigma * Math.sqrt(days / 365);
  return { move, lower: Math.max(0, spot - move), upper: spot + move };
}

export async function getIvUniverse(projectionDays = 14): Promise<IvUniverseResponse> {
  const response = await apiClient.get<IvUniverseResponse>("/volatility/universe", {
    params: { projection_days: Math.min(60, Math.max(1, Math.trunc(projectionDays))) },
  });
  return response.data;
}
