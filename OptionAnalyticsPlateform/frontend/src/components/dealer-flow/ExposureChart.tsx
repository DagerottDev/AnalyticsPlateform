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
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        No data available for {title}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">{title}</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={true} vertical={false} />
            <XAxis 
              type="number" 
              stroke="#a1a1aa" 
              fontSize={10} 
              tickFormatter={(value) => `${value}M`}
            />
            <YAxis 
              dataKey="strike" 
              type="category" 
              stroke="#a1a1aa" 
              fontSize={10} 
              width={60}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip 
              cursor={{ fill: '#27272a', opacity: 0.5 }}
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', fontSize: '12px', color: '#e4e4e7' }}
              itemStyle={{ color: '#e4e4e7' }}
              labelFormatter={(label) => `Strike: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <ReferenceLine x={0} stroke="#52525b" />
            
            {spotPrice > 0 && (
               <ReferenceLine 
                 y={spotPrice} 
                 stroke="#3b82f6" 
                 strokeDasharray="3 3" 
               />
            )}

            <Bar dataKey="Call (M)" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={8} stackId="a" />
            <Bar dataKey="Put (M)" fill="#d946ef" radius={[4, 0, 0, 4]} barSize={8} stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
