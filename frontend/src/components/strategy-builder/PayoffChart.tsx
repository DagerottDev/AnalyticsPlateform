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
import { EmptyState } from "@/components/ui/EmptyState";

interface PayoffChartProps {
  data: PayoffPoint[];
  currentSpot: number;
}

export function PayoffChart({ data, currentSpot }: PayoffChartProps) {
  const chartData = useMemo(() => {
    return data.map(d => ({
      spot: Number(d.strike.toFixed(0)),
      "PnL at Expiry": Number(d.profitAtExpiry.toFixed(2)),
      "T+Today": Number(d.profitT0.toFixed(2)),
    }));
  }, [data]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="panel flex h-[400px] items-center justify-center">
        <EmptyState title="Add strategy legs to view payoff profile." />
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
    <div className="panel flex flex-col gap-2">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Payoff Profile</h3>
      <div className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <defs>
              <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor="var(--color-profit)" stopOpacity={0.2} />
                <stop offset={off} stopColor="var(--color-loss)" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
            <XAxis
              dataKey="spot"
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="var(--color-chart-axis-text)"
              fontSize={11}
            />
            <YAxis
              stroke="var(--color-chart-axis-text)"
              fontSize={11}
              domain={[-limit, limit]}
              tickFormatter={(value) => value > 1000 ? `${(value/1000).toFixed(1)}k` : value}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-border-accent)', strokeWidth: 1, strokeDasharray: '3 3' }}
              contentStyle={{ backgroundColor: 'var(--color-chart-tooltip-bg)', borderColor: 'var(--color-chart-tooltip-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-primary)' }}
              itemStyle={{ color: 'var(--color-text-primary)' }}
              labelFormatter={(label) => `Spot: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />

            <ReferenceLine y={0} stroke="var(--color-border-accent)" strokeWidth={2} />

            {currentSpot > 0 && (
               <ReferenceLine
                 x={currentSpot}
                 stroke="var(--color-accent-blue)"
                 strokeDasharray="3 3"
                 label={{ position: 'insideTopLeft', value: 'Spot', fill: 'var(--color-accent-blue)', fontSize: 11 }}
               />
            )}

            <Area
              type="linear"
              dataKey="PnL at Expiry"
              stroke="var(--color-text-bright)"
              strokeWidth={2}
              fill="url(#splitColor)"
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="T+Today"
              stroke="var(--color-cat-1)"
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
