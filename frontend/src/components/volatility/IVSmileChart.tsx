"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { EmptyState } from "@/components/ui/EmptyState";

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

  if (!chartData || chartData.length === 0) {
    return (
      <div className="panel flex h-[300px] items-center justify-center">
        <EmptyState title="No IV data available. Ensure the market is open and live ticks are flowing." />
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-2">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Volatility Smile</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}
