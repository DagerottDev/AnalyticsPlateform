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
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        No IV data available. Ensure market is open or mock ticks are flowing.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Volatility Smile</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis 
              dataKey="strike" 
              stroke="#a1a1aa" 
              fontSize={12} 
              tickLine={false} 
              axisLine={{ stroke: '#3f3f46' }} 
              domain={['dataMin', 'dataMax']}
              type="number"
            />
            <YAxis 
              stroke="#a1a1aa" 
              fontSize={12} 
              tickLine={false} 
              axisLine={{ stroke: '#3f3f46' }}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', fontSize: '12px', color: '#e4e4e7' }}
              itemStyle={{ color: '#e4e4e7' }}
              labelFormatter={(label) => `Strike: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line 
              type="monotone" 
              dataKey="Call IV" 
              stroke="#22c55e" 
              strokeWidth={2} 
              dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }} 
              activeDot={{ r: 5 }} 
              connectNulls
            />
            <Line 
              type="monotone" 
              dataKey="Put IV" 
              stroke="#ef4444" 
              strokeWidth={2} 
              dot={{ r: 3, fill: "#ef4444", strokeWidth: 0 }} 
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
