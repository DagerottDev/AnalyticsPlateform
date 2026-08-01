"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OpenInterestStrike } from "@/lib/openInterestAnalysis";

interface OpenInterestChangeChartProps {
  data: OpenInterestStrike[];
}

export function OpenInterestChangeChart({ data }: OpenInterestChangeChartProps) {
  const chartData = useMemo(() => data.map((row) => ({
    strike: row.strike,
    "Call change": row.callChange,
    "Put change": row.putChange,
  })), [data]);

  if (chartData.length === 0) {
    return <section className="panel"><EmptyState title="No session OI-change data is available for this expiry." /></section>;
  }

  return (
    <section className="panel flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-sm font-bold text-[var(--color-text-bright)]">Session OI Change</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Change since the broker&apos;s prior-close baseline for the current market session. Positive bars mean OI has increased.
        </p>
      </div>
      <div
        role="img"
        aria-label={`Session open-interest change chart across ${chartData.length} strikes. Exact call and put changes are available in the following data table.`}
        className="h-[440px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 12, right: 20, left: 4, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="strike" stroke="var(--color-chart-axis-text)" fontSize={10} tickFormatter={(value) => Number(value).toLocaleString("en-IN")} />
            <YAxis stroke="var(--color-chart-axis-text)" fontSize={10} tickFormatter={(value) => Number(value).toLocaleString("en-IN")} />
            <Tooltip
              cursor={{ fill: "var(--color-chart-grid)", opacity: 0.45 }}
              contentStyle={{ backgroundColor: "var(--color-chart-tooltip-bg)", borderColor: "var(--color-chart-tooltip-border)", borderRadius: "8px", color: "var(--color-text-primary)" }}
              formatter={(value: number, name: string) => [value.toLocaleString("en-IN"), name]}
              labelFormatter={(label) => `Strike: ${Number(label).toLocaleString("en-IN")}`}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey="Put change" fill="var(--color-profit)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Call change" fill="var(--color-loss)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        title="session open interest change"
        summary={`${data.length} strikes. Changes are from the broker's previous-close baseline for the current trading session.`}
        columns={[{ key: "strike", label: "Strike" }, { key: "callChange", label: "Call change" }, { key: "putChange", label: "Put change" }]}
        rows={data.map((row) => ({ strike: row.strike.toLocaleString(), callChange: row.callChange.toLocaleString(), putChange: row.putChange.toLocaleString() }))}
      />
    </section>
  );
}
