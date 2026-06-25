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
  Cell,
  ReferenceLine
} from "recharts";
import { StrikeExposure } from "@/lib/dealerFlow";

interface GEXProfileChartProps {
  data: StrikeExposure[];
  spotPrice: number;
}

export function GEXProfileChart({ data, spotPrice }: GEXProfileChartProps) {
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

  if (!chartData || chartData.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        No GEX data available.
      </div>
    );
  }

  // Find min/max for domain
  const maxAbsGex = Math.max(
    ...chartData.map(d => Math.max(Math.abs(d["Call GEX (M)"] || 0), Math.abs(d["Put GEX (M)"] || 0)))
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Gamma Exposure (GEX) Profile</h3>
      <div className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={true} vertical={false} />
            <XAxis 
              type="number" 
              stroke="#a1a1aa" 
              fontSize={11} 
              domain={[-maxAbsGex * 1.1, maxAbsGex * 1.1]}
              tickFormatter={(value) => `${value}M`}
            />
            <YAxis 
              dataKey="strike" 
              type="category" 
              stroke="#a1a1aa" 
              fontSize={11} 
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
                 label={{ position: 'insideTopRight', value: 'Spot', fill: '#3b82f6', fontSize: 10 }} 
               />
            )}

            <Bar dataKey="Call GEX (M)" fill="#22c55e" radius={[0, 4, 4, 0]} barSize={12} stackId="a" />
            <Bar dataKey="Put GEX (M)" fill="#ef4444" radius={[4, 0, 0, 4]} barSize={12} stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
