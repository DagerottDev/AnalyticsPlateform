"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, UsersRound } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { LatestPositionChart, NetOiTrendChart, PositionChangeChart, VolumeTrendChart } from "@/components/participant-flow/ParticipantFlowCharts";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EducationPopover } from "@/components/ui/EducationPopover";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatTile } from "@/components/ui/StatTile";
import {
  getParticipantFlow,
  latestPositionChange,
  latestRows,
  PARTICIPANT_LABELS,
  positionSummary,
  type ParticipantDataStatus,
  type ParticipantExposure,
  type ParticipantFlowResponse,
  type ParticipantSegment,
  type ParticipantType,
} from "@/lib/participantFlow";
import { cn } from "@/lib/utils";

const PERIODS = [{ label: "1M", days: 30 }, { label: "3M", days: 90 }, { label: "6M", days: 180 }, { label: "1Y", days: 366 }];
const PARTICIPANTS: ParticipantType[] = ["FII_FPI", "DII", "PROPRIETARY", "CLIENT"];

const formatContracts = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
const formatDate = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

function statusCopy(status: ParticipantDataStatus): { label: string; detail: string; tone: string } {
  switch (status) {
    case "ready": return { label: "Official report ready", detail: "Latest published NSE participant report", tone: "border-[var(--color-profit)]/30 bg-[var(--color-profit)]/10 text-[var(--color-profit)]" };
    case "backfilling": return { label: "Historical backfill in progress", detail: "Latest report is retained while prior reports load", tone: "border-[var(--color-accent-blue)]/30 bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]" };
    case "stale": return { label: "Report may be delayed", detail: "Showing the latest stored official report", tone: "border-[var(--color-accent-orange)]/30 bg-[var(--color-accent-orange)]/10 text-[var(--color-accent-orange)]" };
    case "unavailable": return { label: "NSE report unavailable", detail: "No official participant report could be loaded yet", tone: "border-[var(--color-loss)]/30 bg-[var(--color-loss)]/10 text-[var(--color-loss)]" };
  }
}

function FilterButton<T extends string | number>({ value, current, onSelect, children }: { value: T; current: T; onSelect: (value: T) => void; children: React.ReactNode }) {
  return <button type="button" onClick={() => onSelect(value)} className={cn(
    "focus-ring rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
    current === value ? "bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
  )}>{children}</button>;
}

function ParticipantInsight({ participant, response, segment, exposure }: { participant: ParticipantType; response: ParticipantFlowResponse; segment: ParticipantSegment; exposure: ParticipantExposure }) {
  const row = latestRows(response.rows).get(participant);
  const summary = row ? positionSummary(row.oi, segment, exposure) : null;
  const change = latestPositionChange(response.rows, participant, segment, exposure);
  const ratio = summary && summary.short > 0 ? summary.long / summary.short : null;
  return <StatTile
    label={`${PARTICIPANT_LABELS[participant]} net OI`}
    value={formatContracts(summary?.net ?? null)}
    tone={(summary?.net ?? 0) > 0 ? "profit" : (summary?.net ?? 0) < 0 ? "loss" : "neutral"}
    education={<EducationPopover title={`${PARTICIPANT_LABELS[participant]} positioning`} description="Net OI is the selected long-contract total minus its selected short-contract total in NSE's daily participant report." tips={[`One-day net change: ${formatContracts(change)} contracts.`, `Long / short ratio: ${ratio?.toFixed(2) ?? "—"}.`]} />}
  />;
}

export default function ParticipantFlowPage() {
  const [days, setDays] = useState(90);
  const [response, setResponse] = useState<ParticipantFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [segment, setSegment] = useState<ParticipantSegment>("combined");
  const [exposure, setExposure] = useState<ParticipantExposure>("futures");
  const [participants, setParticipants] = useState<ParticipantType[]>(PARTICIPANTS);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResponse(await getParticipantFlow(days)); }
    catch (loadError) { setError(loadError); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const currentStatus = response ? statusCopy(response.status) : null;
  const divergent = useMemo(() => {
    if (!response) return null;
    const latest = latestRows(response.rows);
    const fii = latest.get("FII_FPI"); const client = latest.get("CLIENT");
    if (!fii || !client) return null;
    const fiiNet = positionSummary(fii.oi, segment, exposure).net;
    const clientNet = positionSummary(client.oi, segment, exposure).net;
    if (!fiiNet || !clientNet) return "FII/FPI and Client positioning is balanced in this view.";
    return fiiNet * clientNet < 0
      ? "FII/FPI and Client net positioning are on opposite sides in this view."
      : "FII/FPI and Client net positioning point to the same side in this view.";
  }, [response, segment, exposure]);

  const toggleParticipant = (participant: ParticipantType) => setParticipants((current) => {
    if (current.includes(participant)) return current.length > 1 ? current.filter((item) => item !== participant) : current;
    return [...current, participant];
  });

  return <DashboardLayout><PageContainer className="max-w-[1800px]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2"><SectionHeader title="Participant Flow" description="Official NSE F&O participant positioning and trading-volume history." />
        <EducationPopover title="Participant Flow" description="NSE publishes participant-wise F&O open interest and trading volume after the trading day. This page uses the latest official report, not intraday participant estimates." tips={["OI measures positions held at day-end; volume measures contracts traded during that day.", "Net OI is long contracts minus short contracts for the active filters.", "Participant positioning is descriptive context, not a directional recommendation."]} />
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh</Button>
    </div>

    <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--color-bg-hover)] p-1" aria-label="History range">
        {PERIODS.map((period) => <FilterButton key={period.days} value={period.days} current={days} onSelect={setDays}>{period.label}</FilterButton>)}
      </div>
      {currentStatus && <div role="status" className={cn("rounded-lg border px-3 py-2 text-right", currentStatus.tone)}>
        <p className="text-xs font-bold uppercase tracking-wide">{currentStatus.label}</p><p className="mt-0.5 text-xs opacity-85">{currentStatus.detail}</p>
        <p className="mt-1 text-xs opacity-85">Latest report: {formatDate(response?.latest_report_date ?? null)}</p>
        {response?.last_error && <p className="mt-1 max-w-[32rem] break-words text-left text-[11px] opacity-75" title={response.last_error}>Importer detail: {response.last_error}</p>}
      </div>}
    </Card>

    <Card className="mt-4 flex flex-wrap gap-4" aria-label="Participant data filters">
      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Segment</p><div className="flex rounded-lg bg-[var(--color-bg-hover)] p-1">
        <FilterButton value="combined" current={segment} onSelect={setSegment}>Combined</FilterButton><FilterButton value="index" current={segment} onSelect={setSegment}>Index</FilterButton><FilterButton value="stock" current={segment} onSelect={setSegment}>Stock</FilterButton>
      </div></div>
      <div><p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Exposure</p><div className="flex rounded-lg bg-[var(--color-bg-hover)] p-1">
        <FilterButton value="futures" current={exposure} onSelect={setExposure}>Futures</FilterButton><FilterButton value="options" current={exposure} onSelect={setExposure}>Options</FilterButton><FilterButton value="combined" current={exposure} onSelect={setExposure}>Combined</FilterButton>
      </div></div>
      <fieldset><legend className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">Participants</legend><div className="flex flex-wrap gap-2">
        {PARTICIPANTS.map((participant) => <label key={participant} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"><input type="checkbox" checked={participants.includes(participant)} onChange={() => toggleParticipant(participant)} className="accent-[var(--color-accent-blue)]" />{PARTICIPANT_LABELS[participant]}</label>)}
      </div></fieldset>
    </Card>

    {loading && !response ? <Card className="mt-4"><LoadingState size="lg" label="Loading official NSE participant reports…" /></Card>
      : error ? <Card className="mt-4"><EmptyState title="Could not load Participant Flow." /><ApiErrorDisplay error={error} /></Card>
      : !response || response.rows.length === 0 ? <Card className="mt-4"><EmptyState title="Official participant reports are not available yet." description="The service will continue checking NSE and backfill history once the report is published." /></Card>
      : <>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ParticipantInsight participant="FII_FPI" response={response} segment={segment} exposure={exposure} />
          <ParticipantInsight participant="PROPRIETARY" response={response} segment={segment} exposure={exposure} />
          <ParticipantInsight participant="CLIENT" response={response} segment={segment} exposure={exposure} />
          <StatTile label="FII / Client read" value={divergent?.includes("opposite") ? "Divergent" : "Aligned"} icon={UsersRound} education={<EducationPopover title="FII / Client comparison" description={divergent ?? "Comparison becomes available when both categories have a report."} tips={["This compares net positions under the selected segment and exposure filters.", "It does not predict market direction or individual participant intent."]} />} />
        </div>
        {response.status !== "ready" && <div className="mt-4 rounded-lg border border-[var(--color-accent-orange)]/30 bg-[var(--color-accent-orange)]/5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">The dashboard is showing the latest stored official data. NSE participant reports are daily publications, so no intraday participant position is inferred.</div>}
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <NetOiTrendChart rows={response.rows} participants={participants} segment={segment} exposure={exposure} />
          <LatestPositionChart rows={response.rows} participants={participants} segment={segment} exposure={exposure} />
          <VolumeTrendChart rows={response.rows} participants={participants} segment={segment} exposure={exposure} />
          <PositionChangeChart rows={response.rows} participants={participants} segment={segment} exposure={exposure} />
        </div>
      </>}
  </PageContainer></DashboardLayout>;
}
