import { apiClient } from "@/lib/api";

export type ParticipantType = "CLIENT" | "DII" | "FII_FPI" | "PROPRIETARY";
export type ParticipantDataStatus = "ready" | "backfilling" | "stale" | "unavailable";
export type ParticipantSegment = "combined" | "index" | "stock";
export type ParticipantExposure = "combined" | "futures" | "options";

export interface ParticipantMetrics {
  future_index_long: number;
  future_index_short: number;
  future_stock_long: number;
  future_stock_short: number;
  option_index_call_long: number;
  option_index_put_long: number;
  option_index_call_short: number;
  option_index_put_short: number;
  option_stock_call_long: number;
  option_stock_put_long: number;
  option_stock_call_short: number;
  option_stock_put_short: number;
  total_long: number;
  total_short: number;
}

export interface ParticipantFlowRow {
  trade_date: string;
  participant_type: ParticipantType;
  oi: ParticipantMetrics;
  volume: ParticipantMetrics;
  net_oi: number;
  net_oi_change: number | null;
}

export interface ParticipantFlowResponse {
  source: "NSE";
  status: ParticipantDataStatus;
  latest_report_date: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  history_start_date: string | null;
  backfill_target_start_date: string | null;
  backfill_completed_at: string | null;
  last_error: string | null;
  rows: ParticipantFlowRow[];
}

export const PARTICIPANT_LABELS: Record<ParticipantType, string> = {
  CLIENT: "Client",
  DII: "DII",
  FII_FPI: "FII / FPI",
  PROPRIETARY: "Proprietary",
};

export const PARTICIPANT_COLORS: Record<ParticipantType, string> = {
  CLIENT: "#94a3b8",
  DII: "#a78bfa",
  FII_FPI: "#22d3ee",
  PROPRIETARY: "#f59e0b",
};

export async function getParticipantFlow(days: number): Promise<ParticipantFlowResponse> {
  const { data } = await apiClient.get<ParticipantFlowResponse>("/participant-flow", { params: { days } });
  return data;
}

function metricNames(segment: ParticipantSegment, exposure: ParticipantExposure): string[] {
  const areas = segment === "combined" ? ["index", "stock"] : [segment];
  const exposures = exposure === "combined" ? ["future", "option"] : [exposure === "futures" ? "future" : "option"];
  return areas.flatMap((area) => exposures.flatMap((kind) => {
    if (kind === "future") return [`future_${area}_long`, `future_${area}_short`];
    return [
      `option_${area}_call_long`, `option_${area}_put_long`,
      `option_${area}_call_short`, `option_${area}_put_short`,
    ];
  }));
}

export function positionSummary(
  metrics: ParticipantMetrics,
  segment: ParticipantSegment,
  exposure: ParticipantExposure,
): { long: number; short: number; net: number } {
  let long = 0;
  let short = 0;
  for (const key of metricNames(segment, exposure)) {
    const value = metrics[key as keyof ParticipantMetrics] ?? 0;
    if (key.endsWith("_long")) long += value;
    else short += value;
  }
  return { long, short, net: long - short };
}

export function latestRows(rows: ParticipantFlowRow[]): Map<ParticipantType, ParticipantFlowRow> {
  const latest = new Map<ParticipantType, ParticipantFlowRow>();
  for (const row of rows) latest.set(row.participant_type, row);
  return latest;
}

export function latestPositionChange(
  rows: ParticipantFlowRow[],
  participant: ParticipantType,
  segment: ParticipantSegment,
  exposure: ParticipantExposure,
): number | null {
  const series = rows.filter((row) => row.participant_type === participant);
  if (series.length < 2) return null;
  const latest = positionSummary(series.at(-1)!.oi, segment, exposure).net;
  const previous = positionSummary(series.at(-2)!.oi, segment, exposure).net;
  return latest - previous;
}
