"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { StrikeExposure } from "@/lib/dealerFlow";
import { ChartPanel } from "@/components/charts/ChartPanel";
import { useCategoryChartZoom } from "@/hooks/useCategoryChartZoom";

interface GEXProfileChartProps {
  data: StrikeExposure[];
  spotPrice: number;
  education?: ReactNode;
}

export function GEXProfileChart({ data, spotPrice, education }: GEXProfileChartProps) {
  const chartData = useMemo(() => {
    return data
      .filter(d => d.totalExposure !== 0)
      .map(d => ({
        strike: d.strike,
        // Convert to Millions for readability
        "Call GEX (M)": Number((d.callExposure / 1000000).toFixed(2)),
        "Put GEX (M)": Number((d.putExposure / 1000000).toFixed(2)),
        "Net GEX (M)": Number((d.totalExposure / 1000000).toFixed(2)),
      }));
  }, [data]);
  const centreIndex = useMemo(() => chartData.reduce((best, row, index) => Math.abs(row.strike - spotPrice) < Math.abs(chartData[best].strike - spotPrice) ? index : best, 0), [chartData, spotPrice]);
  const zoom = useCategoryChartZoom(chartData, centreIndex);

  // Find min/max for domain
  const maxAbsGex = chartData.length === 0 ? 0 : Math.max(
    ...chartData.map(d => Math.max(Math.abs(d["Call GEX (M)"] || 0), Math.abs(d["Put GEX (M)"] || 0)))
  );

  return (
    <ChartPanel
      isEmpty={chartData.length === 0}
      emptyTitle="No GEX data available."
      height="h-[400px]"
      title={<>Gamma Exposure (GEX) Profile{education}</>}
      zoomLabel="gamma exposure profile"
      ariaLabel={`Gamma exposure profile across ${chartData.length} strikes. Spot price is ${spotPrice.toFixed(2)}. Exact call and put exposure values are available in the following data table.`}
      onZoomIn={zoom.zoomIn}
      onZoomOut={zoom.zoomOut}
      onZoomReset={zoom.resetZoom}
      tableTitle="gamma exposure profile"
      tableSummary={`${chartData.length} strikes. Exposure values are shown in millions; spot price is ${spotPrice.toFixed(2)}.`}
      tableColumns={[{ key: "strike", label: "Strike" }, { key: "Call GEX (M)", label: "Call GEX (M)" }, { key: "Put GEX (M)", label: "Put GEX (M)" }, { key: "Net GEX (M)", label: "Net GEX (M)" }]}
      tableRows={chartData}
    >
      <BarChart data={zoom.visibleData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" horizontal={true} vertical={false} />
        <XAxis
          type="number"
          stroke="var(--color-chart-axis-text)"
          fontSize={11}
          domain={[-maxAbsGex * 1.1, maxAbsGex * 1.1]}
          tickFormatter={(value) => `${value}M`}
        />
        <YAxis
          dataKey="strike"
          type="category"
          stroke="var(--color-chart-axis-text)"
          fontSize={11}
          width={60}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-chart-grid)', opacity: 0.5 }}
          contentStyle={{ backgroundColor: 'var(--color-chart-tooltip-bg)', borderColor: 'var(--color-chart-tooltip-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-primary)' }}
          itemStyle={{ color: 'var(--color-text-primary)' }}
          labelFormatter={(label) => `Strike: ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: '12px' }} />
        <ReferenceLine x={0} stroke="var(--color-border-accent)" />

        {spotPrice > 0 && (
           <ReferenceLine
             y={spotPrice}
             stroke="var(--color-accent-blue)"
             strokeDasharray="3 3"
             label={{ position: 'insideTopRight', value: 'Spot', fill: 'var(--color-accent-blue)', fontSize: 10 }}
           />
        )}

        <Bar dataKey="Call GEX (M)" fill="var(--color-profit)" radius={[0, 4, 4, 0]} barSize={12} stackId="a" />
        <Bar dataKey="Put GEX (M)" fill="var(--color-loss)" radius={[4, 0, 0, 4]} barSize={12} stackId="a" />
      </BarChart>
    </ChartPanel>
  );
}
