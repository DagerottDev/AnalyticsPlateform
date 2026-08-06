"use client";

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartPanel } from "@/components/charts/ChartPanel";
import { useCategoryChartZoom } from "@/hooks/useCategoryChartZoom";

interface IVSmileChartProps {
  data: {
    strike: number;
    ceIV: number;
    peIV: number;
  }[];
}

export function IVSmileChart({ data }: IVSmileChartProps) {
  const chartData = useMemo(() => {
    return data
      .filter(d => d.ceIV > 0 || d.peIV > 0)
      .map(d => ({
        strike: d.strike,
        "Call IV": d.ceIV > 0 ? Number((d.ceIV * 100).toFixed(2)) : null,
        "Put IV": d.peIV > 0 ? Number((d.peIV * 100).toFixed(2)) : null,
      }));
  }, [data]);
  const zoom = useCategoryChartZoom(chartData);

  return (
    <ChartPanel
      isEmpty={chartData.length === 0}
      emptyTitle="No IV data available. Ensure the market is open and live ticks are flowing."
      height="h-[300px]"
      title="Volatility Smile"
      zoomLabel="volatility smile"
      ariaLabel={`Volatility smile line chart across ${chartData.length} strikes. Exact call and put implied volatility values are available in the following data table.`}
      onZoomIn={zoom.zoomIn}
      onZoomOut={zoom.zoomOut}
      onZoomReset={zoom.resetZoom}
      tableTitle="volatility smile"
      tableSummary={`${chartData.length} strikes with call and put implied volatility percentages.`}
      tableColumns={[{ key: "strike", label: "Strike" }, { key: "Call IV", label: "Call IV" }, { key: "Put IV", label: "Put IV" }]}
      tableRows={chartData.map((point) => ({ ...point, "Call IV": point["Call IV"] == null ? null : `${point["Call IV"]}%`, "Put IV": point["Put IV"] == null ? null : `${point["Put IV"]}%` }))}
    >
      <LineChart data={zoom.visibleData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
        <XAxis
          dataKey="strike"
          stroke="var(--color-chart-axis-text)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-chart-grid)' }}
          domain={['dataMin', 'dataMax']}
          type="number"
        />
        <YAxis
          stroke="var(--color-chart-axis-text)"
          fontSize={12}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-chart-grid)' }}
          tickFormatter={(value) => `${value}%`}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'var(--color-chart-tooltip-bg)', borderColor: 'var(--color-chart-tooltip-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-primary)' }}
          itemStyle={{ color: 'var(--color-text-primary)' }}
          labelFormatter={(label) => `Strike: ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: '12px' }} />
        <Line
          type="monotone"
          dataKey="Call IV"
          stroke="var(--color-profit)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-profit)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="Put IV"
          stroke="var(--color-loss)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-loss)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ChartPanel>
  );
}
