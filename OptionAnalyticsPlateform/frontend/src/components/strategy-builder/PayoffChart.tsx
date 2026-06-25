"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import { PayoffPoint } from "@/lib/strategy";

interface PayoffChartProps {
  data: PayoffPoint[];
  currentSpot: number;
}

export function PayoffChart({ data, currentSpot }: PayoffChartProps) {
  const chartData = useMemo(() => {
    return data.map(d => ({
      spot: Number(d.spot.toFixed(0)),
      "PnL at Expiry": Number(d.pnlExpiry.toFixed(2)),
      "T+Today": Number(d.pnlToday.toFixed(2)),
    }));
  }, [data]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        Add strategy legs to view payoff profile.
      </div>
    );
  }

  // Calculate domain to keep zero centered if possible, or at least visible
  const maxPnL = Math.max(...chartData.map(d => Math.max(d["PnL at Expiry"], d["T+Today"])));
  const minPnL = Math.min(...chartData.map(d => Math.min(d["PnL at Expiry"], d["T+Today"])));
  
  // Symmetrical Y axis
  const limit = Math.max(Math.abs(maxPnL), Math.abs(minPnL)) * 1.1;

  // Custom gradient for area fill
  const gradientOffset = () => {
    const dataMax = maxPnL;
    const dataMin = minPnL;
    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;
    return dataMax / (dataMax - dataMin);
  };
  const off = gradientOffset();

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Payoff Profile</h3>
      <div className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <defs>
              <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset={off} stopColor="#ef4444" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis 
              dataKey="spot" 
              type="number" 
              domain={['dataMin', 'dataMax']}
              stroke="#a1a1aa" 
              fontSize={11} 
            />
            <YAxis 
              stroke="#a1a1aa" 
              fontSize={11} 
              domain={[-limit, limit]}
              tickFormatter={(value) => value > 1000 ? `${(value/1000).toFixed(1)}k` : value}
            />
            <Tooltip 
              cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '3 3' }}
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', fontSize: '12px', color: '#e4e4e7' }}
              itemStyle={{ color: '#e4e4e7' }}
              labelFormatter={(label) => `Spot: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={2} />
            
            {currentSpot > 0 && (
               <ReferenceLine 
                 x={currentSpot} 
                 stroke="#3b82f6" 
                 strokeDasharray="3 3" 
                 label={{ position: 'insideTopLeft', value: 'Spot', fill: '#3b82f6', fontSize: 11 }} 
               />
            )}

            <Area 
              type="linear" 
              dataKey="PnL at Expiry" 
              stroke="#e4e4e7" 
              strokeWidth={2}
              fill="url(#splitColor)" 
              isAnimationActive={false}
            />
            
            <Line 
              type="monotone" 
              dataKey="T+Today" 
              stroke="#a855f7" 
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
