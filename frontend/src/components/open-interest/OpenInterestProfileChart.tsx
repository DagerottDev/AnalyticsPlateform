"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartZoomControls } from "@/components/charts/ChartZoomControls";
import { useCategoryChartZoom } from "@/hooks/useCategoryChartZoom";
import type { OpenInterestLevel, OpenInterestStrike } from "@/lib/openInterestAnalysis";

interface OpenInterestProfileChartProps {
  data: OpenInterestStrike[];
  spot: number;
  support: OpenInterestLevel | null;
  resistance: OpenInterestLevel | null;
}

export function OpenInterestProfileChart({ data, spot, support, resistance }: OpenInterestProfileChartProps) {
  const chartData = useMemo(() => data.map((row) => ({
    strike: row.strike,
    "Call OI": row.callOi,
    "Put OI": -row.putOi,
  })), [data]);
  const centreIndex = useMemo(() => chartData.reduce((best, row, index) => Math.abs(row.strike - spot) < Math.abs(chartData[best].strike - spot) ? index : best, 0), [chartData, spot]);
  const zoom = useCategoryChartZoom(chartData, centreIndex);

  if (chartData.length === 0) {
    return <section className="panel"><EmptyState title="No open-interest data is available for this expiry." /></section>;
  }

  return (
    <section className="panel flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2"><div>
        <h2 className="text-sm font-bold text-[var(--color-text-bright)]">Open Interest by Strike</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Calls are plotted to the right; puts are plotted to the left. Dashed levels show the largest relevant OI concentrations.
        </p></div><ChartZoomControls label="open interest by strike" onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onReset={zoom.resetZoom} /></div>
      <div
        role="img"
        aria-label={`Open interest profile across ${chartData.length} strikes. Spot is ${spot.toFixed(2)}. Support is ${support?.strike ?? "unavailable"}; resistance is ${resistance?.strike ?? "unavailable"}. Exact values are available in the following data table.`}
        className="h-[440px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={zoom.visibleData} layout="vertical" margin={{ top: 12, right: 30, left: 12, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" horizontal={true} vertical={false} />
            <XAxis
              type="number"
              tickFormatter={(value) => Math.abs(value).toLocaleString("en-IN")}
              stroke="var(--color-chart-axis-text)"
              fontSize={10}
            />
            <YAxis dataKey="strike" type="category" width={68} stroke="var(--color-chart-axis-text)" fontSize={10} />
            <Tooltip
              cursor={{ fill: "var(--color-chart-grid)", opacity: 0.45 }}
              contentStyle={{ backgroundColor: "var(--color-chart-tooltip-bg)", borderColor: "var(--color-chart-tooltip-border)", borderRadius: "8px", color: "var(--color-text-primary)" }}
              formatter={(value: number, name: string) => [Math.abs(value).toLocaleString("en-IN"), name]}
              labelFormatter={(label) => `Strike: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            {support && <ReferenceLine y={support.strike} stroke="var(--color-profit)" strokeDasharray="4 4" label={{ value: "Support", fill: "var(--color-profit)", fontSize: 10 }} />}
            {resistance && <ReferenceLine y={resistance.strike} stroke="var(--color-loss)" strokeDasharray="4 4" label={{ value: "Resistance", fill: "var(--color-loss)", fontSize: 10 }} />}
            <Bar dataKey="Put OI" fill="var(--color-profit)" radius={[4, 0, 0, 4]} barSize={11} />
            <Bar dataKey="Call OI" fill="var(--color-loss)" radius={[0, 4, 4, 0]} barSize={11} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        title="open interest profile"
        summary={`${data.length} strikes. Call and put OI are broker option-chain snapshots; support and resistance are OI concentrations, not trade advice.`}
        columns={[{ key: "strike", label: "Strike" }, { key: "callOi", label: "Call OI" }, { key: "putOi", label: "Put OI" }]}
        rows={data.map((row) => ({ strike: row.strike.toLocaleString(), callOi: row.callOi.toLocaleString(), putOi: row.putOi.toLocaleString() }))}
      />
    </section>
  );
}
