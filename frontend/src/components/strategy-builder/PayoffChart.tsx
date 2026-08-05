"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/Button";
import { LineChart as LineChartIcon, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { ChartDataTable } from "@/components/charts/ChartDataTable";

const MAX_ZOOM_LEVEL = 5;
const ZOOM_FACTOR = 1.6;

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
  const [zoomLevel, setZoomLevel] = useState(0);

  useEffect(() => {
    setZoomLevel(0);
  }, [data]);

  const xDomain = useMemo<[number, number]>(() => {
    if (chartData.length < 2) {
      const spot = chartData[0]?.spot ?? currentSpot;
      return [spot - 1, spot + 1];
    }

    const fullMin = Math.min(...chartData.map((point) => point.spot));
    const fullMax = Math.max(...chartData.map((point) => point.spot));
    const fullRange = fullMax - fullMin;
    if (!Number.isFinite(fullRange) || fullRange <= 0) return [fullMin - 1, fullMax + 1];

    const center = Math.min(fullMax, Math.max(fullMin, currentSpot));
    const targetRange = fullRange / ZOOM_FACTOR ** zoomLevel;
    let start = center - targetRange / 2;
    let end = center + targetRange / 2;

    if (start < fullMin) {
      start = fullMin;
      end = Math.min(fullMax, start + targetRange);
    }
    if (end > fullMax) {
      end = fullMax;
      start = Math.max(fullMin, end - targetRange);
    }

    return [start, end];
  }, [chartData, currentSpot, zoomLevel]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
          <LineChartIcon className="h-4 w-4 text-[var(--color-accent-blue)]" /> Payoff Profile
        </h3>
        <div className="flex items-center gap-1" aria-label="Payoff chart zoom controls">
          <span className="mr-1 text-[11px] text-[var(--color-text-muted)]">
            {zoomLevel === 0 ? "Full range" : `Zoom: ${(ZOOM_FACTOR ** zoomLevel).toFixed(1)}×`}
          </span>
          <Button
            variant="icon"
            onClick={() => setZoomLevel((level) => Math.max(0, level - 1))}
            disabled={zoomLevel === 0}
            aria-label="Zoom out payoff profile"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="icon"
            onClick={() => setZoomLevel((level) => Math.min(MAX_ZOOM_LEVEL, level + 1))}
            disabled={zoomLevel === MAX_ZOOM_LEVEL}
            aria-label="Zoom in payoff profile"
            title="Zoom in around current spot"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="icon"
            onClick={() => setZoomLevel(0)}
            disabled={zoomLevel === 0}
            aria-label="Reset payoff zoom"
            title="Reset zoom"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div role="img" aria-label={`Strategy payoff profile across ${chartData.length} price points. Current spot is ${currentSpot.toFixed(2)}. Exact expiry and current-theoretical profit and loss values are available in the following data table.`} title="Right-click to reset payoff zoom" onContextMenu={(event) => { event.preventDefault(); setZoomLevel(0); }} className="h-[400px] w-full">
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
              domain={xDomain}
              allowDataOverflow
              stroke="var(--color-chart-axis-text)"
              fontSize={11}
            />
            <YAxis
              stroke="var(--color-chart-axis-text)"
              fontSize={11}
              domain={[-limit, limit]}
              tickFormatter={(value) => Math.abs(value) > 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))}
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
      <ChartDataTable
        title="strategy payoff"
        summary={`${chartData.length} price points. Current spot is ${currentSpot.toFixed(2)}.`}
        columns={[{ key: "spot", label: "Spot" }, { key: "PnL at Expiry", label: "P&L at expiry" }, { key: "T+Today", label: "P&L today" }]}
        rows={chartData}
      />
    </div>
  );
}
