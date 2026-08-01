"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { calculateBollingerBands, calculateEMA, calculateSMA, calculateSupertrend, type OHLCVData } from "@/lib/indicators";
import { MARKET_CHART_LOCALIZATION, formatMarketTick } from "@/lib/chartTime";
import { useGreekChartSync } from "@/components/greek-workspace/GreekChartSyncProvider";
import type { GreekPoint } from "@/lib/strikeGreekAnalysis";

const GRID = "#1e222d";
const BORDER = "#2a2e3e";
const TEXT = "#787b86";

export type GreekOverlay = "none" | "sma" | "ema" | "bbands" | "supertrend";

interface GreekLineChartProps {
  points: GreekPoint[];
  overlay: GreekOverlay;
  overlayPeriod: number;
  bollingerMultiplier: number;
  syncId: string;
}

function normalizePoints(points: GreekPoint[]): GreekPoint[] {
  const valuesBySecond = new Map<number, number>();
  for (const point of points) {
    const time = new Date(point.time).getTime();
    if (!Number.isFinite(point.value) || !Number.isFinite(time)) continue;
    valuesBySecond.set(Math.floor(time / 1000), point.value);
  }
  return Array.from(valuesBySecond, ([time, value]) => ({
    time: new Date(time * 1000).toISOString(),
    value,
  })).sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
}

function toChartData(points: GreekPoint[]) {
  return normalizePoints(points)
    .map((point) => ({ time: (new Date(point.time).getTime() / 1000) as Time, value: point.value }));
}

export function GreekLineChart({ points, overlay, overlayPeriod, bollingerMultiplier, syncId }: GreekLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRefs = useRef<ISeriesApi<"Line">[]>([]);
  const { registerChart, notifyTimeRange } = useGreekChartSync();

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height: 290,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: BORDER },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false, tickMarkFormatter: formatMarketTick },
      localization: MARKET_CHART_LOCALIZATION,
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    const onVisibleTimeRangeChange = (range: Parameters<typeof notifyTimeRange>[1]) => {
      notifyTimeRange(syncId, range);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
    const unregisterChart = registerChart(syncId, chart);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
      unregisterChart();
      chart.remove();
      chartRef.current = null;
      lineRefs.current = [];
    };
  }, [notifyTimeRange, registerChart, syncId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const visibleRange = chart.timeScale().getVisibleRange();
    lineRefs.current.forEach((line) => chart.removeSeries(line));
    lineRefs.current = [];

    const normalizedPoints = normalizePoints(points);
    const combined = chart.addLineSeries({
      color: "#2962ff",
      lineWidth: 3,
      title: "Combined",
      lastValueVisible: true,
    });
    combined.setData(toChartData(normalizedPoints));
    lineRefs.current.push(combined);

    const ohlcv: OHLCVData[] = normalizedPoints.map((point) => ({
      time: point.time,
      open: point.value,
      high: point.value,
      low: point.value,
      close: point.value,
    }));
    if (overlay === "sma") {
      const line = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, lineStyle: 2, title: `SMA ${overlayPeriod}` });
      line.setData(calculateSMA(ohlcv, overlayPeriod).map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.value })));
      lineRefs.current.push(line);
    } else if (overlay === "ema") {
      const line = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, lineStyle: 2, title: `EMA ${overlayPeriod}` });
      line.setData(calculateEMA(ohlcv, overlayPeriod).map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.value })));
      lineRefs.current.push(line);
    } else if (overlay === "bbands") {
      const bands = calculateBollingerBands(ohlcv, overlayPeriod, bollingerMultiplier);
      const upper = chart.addLineSeries({ color: "#ab47bc", lineWidth: 1, lineStyle: 2, title: "BB upper" });
      const lower = chart.addLineSeries({ color: "#ab47bc", lineWidth: 1, lineStyle: 2, title: "BB lower" });
      upper.setData(bands.map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.upper })));
      lower.setData(bands.map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.lower })));
      lineRefs.current.push(upper, lower);
    } else if (overlay === "supertrend") {
      const line = chart.addLineSeries({
        color: "#00bcd4",
        lineWidth: 2,
        lineStyle: 2,
        title: `Supertrend ${overlayPeriod} × ${bollingerMultiplier}`,
      });
      line.setData(calculateSupertrend(ohlcv, overlayPeriod, bollingerMultiplier).map((point) => ({
        time: (new Date(String(point.time)).getTime() / 1000) as Time,
        value: point.value,
      })));
      lineRefs.current.push(line);
    }
    if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
    else chart.timeScale().fitContent();
  }, [points, overlay, overlayPeriod, bollingerMultiplier]);

  return <div ref={containerRef} className="h-[290px] w-full" aria-label="Selected option Greek chart" />;
}
