"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import {
  PARTICIPANT_COLORS,
  PARTICIPANT_LABELS,
  type ParticipantExposure,
  type ParticipantFlowRow,
  type ParticipantSegment,
  type ParticipantType,
  positionSummary,
} from "@/lib/participantFlow";

interface ChartProps {
  rows: ParticipantFlowRow[];
  participants: ParticipantType[];
  segment: ParticipantSegment;
  exposure: ParticipantExposure;
}

const compact = (value: number) => new Intl.NumberFormat("en-IN", {
  notation: "compact", maximumFractionDigits: 1,
}).format(value);
const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
  day: "numeric", month: "short",
});

function groupedRows(props: ChartProps, metric: "net" | "volume" | "change") {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const row of props.rows) {
    if (!props.participants.includes(row.participant_type)) continue;
    const point = byDate.get(row.trade_date) ?? { date: row.trade_date };
    const summary = positionSummary(
      metric === "volume" ? row.volume : row.oi,
      props.segment,
      props.exposure,
    );
    point[row.participant_type] = metric === "change"
      ? 0
      : metric === "volume" ? summary.long + summary.short : summary.net;
    byDate.set(row.trade_date, point);
  }
  if (metric === "change") {
    const previous = new Map<ParticipantType, number>();
    for (const row of props.rows) {
      if (!props.participants.includes(row.participant_type)) continue;
      const point = byDate.get(row.trade_date)!;
      const net = positionSummary(row.oi, props.segment, props.exposure).net;
      point[row.participant_type] = previous.has(row.participant_type)
        ? net - previous.get(row.participant_type)!
        : 0;
      previous.set(row.participant_type, net);
    }
  }
  return [...byDate.values()];
}

function TooltipValue({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }> }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs shadow-lg">
    {payload.map((item) => <p key={item.name} style={{ color: item.color }}>{item.name}: {compact(item.value ?? 0)}</p>)}
  </div>;
}

export function NetOiTrendChart(props: ChartProps) {
  const data = groupedRows(props, "net");
  return <Card className="min-h-[340px]">
    <h3 className="mb-1 font-semibold text-[var(--color-text-bright)]">Net positioning trend</h3>
    <p className="mb-4 text-xs text-[var(--color-text-secondary)]">Long contracts minus short contracts from the official end-of-day OI report.</p>
    <ResponsiveContainer width="100%" height={260}><LineChart data={data} margin={{ top: 8, right: 12, left: 2, bottom: 8 }}>
      <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
      <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={30} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
      <YAxis tickFormatter={compact} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={54} />
      <Tooltip content={<TooltipValue />} /><Legend formatter={(value) => PARTICIPANT_LABELS[value as ParticipantType] ?? value} />
      {props.participants.map((participant) => <Line key={participant} type="monotone" dataKey={participant} stroke={PARTICIPANT_COLORS[participant]} strokeWidth={2} dot={false} />)}
    </LineChart></ResponsiveContainer>
  </Card>;
}

export function LatestPositionChart(props: ChartProps) {
  const latestByType = new Map<ParticipantType, ParticipantFlowRow>();
  for (const row of props.rows) latestByType.set(row.participant_type, row);
  const data = props.participants.flatMap((participant) => {
    const row = latestByType.get(participant);
    if (!row) return [];
    const summary = positionSummary(row.oi, props.segment, props.exposure);
    return [{ participant: PARTICIPANT_LABELS[participant], long: summary.long, short: -summary.short }];
  });
  return <Card className="min-h-[340px]">
    <h3 className="mb-1 font-semibold text-[var(--color-text-bright)]">Latest long / short map</h3>
    <p className="mb-4 text-xs text-[var(--color-text-secondary)]">Gross contracts in the latest official report; short bars extend left.</p>
    <ResponsiveContainer width="100%" height={260}><BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 24, bottom: 8 }}>
      <CartesianGrid stroke="var(--color-border-subtle)" horizontal={false} />
      <XAxis type="number" tickFormatter={compact} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
      <YAxis type="category" dataKey="participant" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={84} />
      <Tooltip content={<TooltipValue />} /><Legend />
      <Bar dataKey="long" name="Long" fill="var(--color-profit)" radius={[0, 4, 4, 0]} />
      <Bar dataKey="short" name="Short" fill="var(--color-loss)" radius={[4, 0, 0, 4]} />
    </BarChart></ResponsiveContainer>
  </Card>;
}

export function VolumeTrendChart(props: ChartProps) {
  const data = groupedRows(props, "volume");
  return <Card className="min-h-[340px]">
    <h3 className="mb-1 font-semibold text-[var(--color-text-bright)]">Participant trading volume</h3>
    <p className="mb-4 text-xs text-[var(--color-text-secondary)]">Daily gross contracts traded, separated from held open interest.</p>
    <ResponsiveContainer width="100%" height={260}><BarChart data={data} margin={{ top: 8, right: 12, left: 2, bottom: 8 }}>
      <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
      <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={30} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
      <YAxis tickFormatter={compact} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={54} />
      <Tooltip content={<TooltipValue />} /><Legend formatter={(value) => PARTICIPANT_LABELS[value as ParticipantType] ?? value} />
      {props.participants.map((participant) => <Bar key={participant} dataKey={participant} stackId="volume" fill={PARTICIPANT_COLORS[participant]} />)}
    </BarChart></ResponsiveContainer>
  </Card>;
}

export function PositionChangeChart(props: ChartProps) {
  const data = groupedRows(props, "change");
  return <Card className="min-h-[340px]">
    <h3 className="mb-1 font-semibold text-[var(--color-text-bright)]">Daily net-position change</h3>
    <p className="mb-4 text-xs text-[var(--color-text-secondary)]">Change in net OI versus the preceding report, not a trade signal.</p>
    <ResponsiveContainer width="100%" height={260}><BarChart data={data} margin={{ top: 8, right: 12, left: 2, bottom: 8 }}>
      <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
      <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={30} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} />
      <YAxis tickFormatter={compact} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} width={54} />
      <Tooltip content={<TooltipValue />} /><Legend formatter={(value) => PARTICIPANT_LABELS[value as ParticipantType] ?? value} />
      {props.participants.map((participant) => <Bar key={participant} dataKey={participant} stackId="change" fill={PARTICIPANT_COLORS[participant]} />)}
    </BarChart></ResponsiveContainer>
  </Card>;
}
