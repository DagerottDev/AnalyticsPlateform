"use client";

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartPanel } from "@/components/charts/ChartPanel";
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

  return (
    <ChartPanel
      isEmpty={chartData.length === 0}
      emptyTitle="No ATM IV data available for term structure."
      height="h-[300px]"
      title="Volatility Term Structure"
      zoomLabel="volatility term structure"
      ariaLabel={`Volatility term structure line chart across ${chartData.length} expiries. Exact at-the-money implied volatility values are available in the following data table.`}
      onZoomIn={zoom.zoomIn}
      onZoomOut={zoom.zoomOut}
      onZoomReset={zoom.resetZoom}
      tableTitle="volatility term structure"
      tableSummary={`${chartData.length} expiries with at-the-money implied volatility percentages.`}
      tableColumns={[{ key: "expiry", label: "Expiry" }, { key: "ATM IV", label: "ATM IV" }]}
      tableRows={chartData.map((point) => ({ ...point, "ATM IV": `${point["ATM IV"]}%` }))}
    >
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
    </ChartPanel>
  );
}
