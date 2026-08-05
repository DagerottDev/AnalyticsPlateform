"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { ChartZoomControls } from "@/components/charts/ChartZoomControls";
import { useCategoryChartZoom } from "@/hooks/useCategoryChartZoom";

interface TermStructureChartProps {
  data: {
    expiry: string;
    atmIV: number;
  }[];
}

export function TermStructureChart({ data }: TermStructureChartProps) {
  const chartData = useMemo(() => {
    return data
      .filter(d => d.atmIV > 0)
      .map(d => ({
        expiry: d.expiry,
        "ATM IV": Number((d.atmIV * 100).toFixed(2)),
      }));
  }, [data]);
  const zoom = useCategoryChartZoom(chartData);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="panel flex h-[300px] items-center justify-center">
        <EmptyState title="No ATM IV data available for term structure." />
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-[var(--color-text-bright)]">Volatility Term Structure</h3><ChartZoomControls label="volatility term structure" onZoomIn={zoom.zoomIn} onZoomOut={zoom.zoomOut} onReset={zoom.resetZoom} /></div>
      <div role="img" aria-label={`Volatility term structure line chart across ${chartData.length} expiries. Exact at-the-money implied volatility values are available in the following data table.`} className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={zoom.visibleData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
            <XAxis
              dataKey="expiry"
              stroke="var(--color-chart-axis-text)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-chart-grid)' }}
              angle={-45}
              textAnchor="end"
              dy={10}
            />
            <YAxis
              stroke="var(--color-chart-axis-text)"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-chart-grid)' }}
              tickFormatter={(value) => `${value}%`}
              domain={['dataMin - 2', 'dataMax + 2']}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--color-chart-tooltip-bg)', borderColor: 'var(--color-chart-tooltip-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-primary)' }}
              itemStyle={{ color: 'var(--color-cat-1)' }}
              labelFormatter={(label) => `Expiry: ${label}`}
            />
            <Line
              type="monotone"
              dataKey="ATM IV"
              stroke="var(--color-cat-1)"
              strokeWidth={2}
              dot={{ r: 4, fill: "var(--color-cat-1)", strokeWidth: 0 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        title="volatility term structure"
        summary={`${chartData.length} expiries with at-the-money implied volatility percentages.`}
        columns={[{ key: "expiry", label: "Expiry" }, { key: "ATM IV", label: "ATM IV" }]}
        rows={chartData.map((point) => ({ ...point, "ATM IV": `${point["ATM IV"]}%` }))}
      />
    </div>
  );
}
