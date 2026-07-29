"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import { StrikeExposure } from "@/lib/dealerFlow";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartDataTable } from "@/components/charts/ChartDataTable";

interface ExposureChartProps {
  title: string;
  data: StrikeExposure[];
  spotPrice: number;
}

export function ExposureChart({ title, data, spotPrice }: ExposureChartProps) {
  const chartData = useMemo(() => {
    return data
      .filter(d => d.totalExposure !== 0)
      .map(d => ({
        strike: d.strike,
        "Call (M)": Number((d.callExposure / 1000000).toFixed(3)),
        "Put (M)": Number((d.putExposure / 1000000).toFixed(3)),
      }));
  }, [data]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="panel flex h-[300px] items-center justify-center">
        <EmptyState title={`No data available for ${title}.`} />
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-2">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">{title}</h3>
      <div role="img" aria-label={`${title} bar chart across ${chartData.length} strikes. Spot price is ${spotPrice.toFixed(2)}. Exact call and put exposure values are available in the following data table.`} className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" horizontal={true} vertical={false} />
            <XAxis
              type="number"
              stroke="var(--color-chart-axis-text)"
              fontSize={10}
              tickFormatter={(value) => `${value}M`}
            />
            <YAxis
              dataKey="strike"
              type="category"
              stroke="var(--color-chart-axis-text)"
              fontSize={10}
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
               />
            )}

            <Bar dataKey="Call (M)" fill="var(--color-profit)" radius={[0, 4, 4, 0]} barSize={8} stackId="a" />
            <Bar dataKey="Put (M)" fill="var(--color-loss)" radius={[4, 0, 0, 4]} barSize={8} stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        title={title}
        summary={`${chartData.length} strikes. Exposure values are shown in millions; spot price is ${spotPrice.toFixed(2)}.`}
        columns={[{ key: "strike", label: "Strike" }, { key: "Call (M)", label: "Call (M)" }, { key: "Put (M)", label: "Put (M)" }]}
        rows={chartData}
      />
    </div>
  );
}
