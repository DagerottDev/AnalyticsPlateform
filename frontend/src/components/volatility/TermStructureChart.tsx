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

  if (!chartData || chartData.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        No ATM IV data available for term structure.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Volatility Term Structure</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis 
              dataKey="expiry" 
              stroke="#a1a1aa" 
              fontSize={11} 
              tickLine={false} 
              axisLine={{ stroke: '#3f3f46' }}
              angle={-45}
              textAnchor="end"
              dy={10}
            />
            <YAxis 
              stroke="#a1a1aa" 
              fontSize={12} 
              tickLine={false} 
              axisLine={{ stroke: '#3f3f46' }}
              tickFormatter={(value) => `${value}%`}
              domain={['dataMin - 2', 'dataMax + 2']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', fontSize: '12px', color: '#e4e4e7' }}
              itemStyle={{ color: '#eab308' }}
              labelFormatter={(label) => `Expiry: ${label}`}
            />
            <Line 
              type="monotone" 
              dataKey="ATM IV" 
              stroke="#eab308" 
              strokeWidth={2} 
              dot={{ r: 4, fill: "#eab308", strokeWidth: 0 }} 
              activeDot={{ r: 6 }} 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
