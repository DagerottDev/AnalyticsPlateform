"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { EmptyState } from "@/components/ui/EmptyState";

interface OpenInterestTotalsChartProps {
  totalCallOi: number;
  totalPutOi: number;
  totalCallChange: number;
  totalPutChange: number;
}

const tooltipStyle = {
  backgroundColor: "var(--color-chart-tooltip-bg)",
  borderColor: "var(--color-chart-tooltip-border)",
  borderRadius: "8px",
  color: "var(--color-text-primary)",
};

export function OpenInterestTotalsChart({
  totalCallOi,
  totalPutOi,
  totalCallChange,
  totalPutChange,
}: OpenInterestTotalsChartProps) {
  const currentData = useMemo(() => [{
    metric: "Current OI",
    "Call OI": totalCallOi,
    "Put OI": totalPutOi,
  }], [totalCallOi, totalPutOi]);
  const changeData = useMemo(() => [{
    metric: "Session change",
    "Call OI change": totalCallChange,
    "Put OI change": totalPutChange,
  }], [totalCallChange, totalPutChange]);

  if (totalCallOi <= 0 && totalPutOi <= 0) {
    return <section className="panel"><EmptyState title="No aggregate call or put OI is available for this expiry." /></section>;
  }

  return (
    <section className="panel flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-sm font-bold text-[var(--color-text-bright)]">Call vs Put Open Interest</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Aggregate contract OI across the selected expiry. Calls and puts use the same colors as the strike-level charts below.
        </p>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ChartPanel
          ariaLabel={`Total open interest: calls ${totalCallOi.toLocaleString("en-IN")}, puts ${totalPutOi.toLocaleString("en-IN")}.`}
          title="Current OI"
          data={currentData}
          callKey="Call OI"
          putKey="Put OI"
        />
        <ChartPanel
          ariaLabel={`Session open-interest change: calls ${totalCallChange.toLocaleString("en-IN")}, puts ${totalPutChange.toLocaleString("en-IN")}.`}
          title="Session OI Change"
          description="Broker change versus prior close; this is the available approximation of change since market open."
          data={changeData}
          callKey="Call OI change"
          putKey="Put OI change"
        />
      </div>

      <ChartDataTable
        title="call versus put open interest"
        summary="Totals cover the selected expiry. Session change is the broker's prior-close baseline, not an independently captured morning snapshot."
        columns={[
          { key: "metric", label: "Metric" },
          { key: "call", label: "Call OI" },
          { key: "put", label: "Put OI" },
        ]}
        rows={[
          { metric: "Current OI", call: totalCallOi.toLocaleString("en-IN"), put: totalPutOi.toLocaleString("en-IN") },
          { metric: "Session OI change", call: totalCallChange.toLocaleString("en-IN"), put: totalPutChange.toLocaleString("en-IN") },
        ]}
      />
    </section>
  );
}

function ChartPanel({
  ariaLabel,
  title,
  description,
  data,
  callKey,
  putKey,
}: {
  ariaLabel: string;
  title: string;
  description?: string;
  data: Record<string, string | number>[];
  callKey: string;
  putKey: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-3">
      <h3 className="text-xs font-bold text-[var(--color-text-bright)]">{title}</h3>
      {description && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p>}
      <div role="img" aria-label={ariaLabel} className="mt-3 h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="metric" stroke="var(--color-chart-axis-text)" fontSize={10} />
            <YAxis stroke="var(--color-chart-axis-text)" fontSize={10} tickFormatter={(value) => Number(value).toLocaleString("en-IN")} />
            <Tooltip
              cursor={{ fill: "var(--color-chart-grid)", opacity: 0.45 }}
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) => [value.toLocaleString("en-IN"), name]}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey={putKey} fill="var(--color-profit)" radius={[4, 4, 0, 0]} />
            <Bar dataKey={callKey} fill="var(--color-loss)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
