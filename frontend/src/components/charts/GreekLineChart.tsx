"use client";

import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { calculateBollingerBands, calculateEMA, calculateSMA, type OHLCVData } from "@/lib/indicators";
import type { GreekPoint } from "@/lib/strikeGreekAnalysis";

const COLORS = ["#2962ff", "#ff9800", "#ab47bc", "#00bcd4", "#66bb6a", "#ef5350"];
const GRID = "#1e222d";
const BORDER = "#2a2e3e";
const TEXT = "#787b86";

export type GreekOverlay = "none" | "sma" | "ema" | "bbands";

interface GreekLineChartProps {
  series: Record<string, GreekPoint[]>;
  focusSymbol: string;
  overlay: GreekOverlay;
  overlayPeriod: number;
  bollingerMultiplier: number;
}

function toChartData(points: GreekPoint[]) {
  return points
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.time).getTime()))
    .map((point) => ({ time: (new Date(point.time).getTime() / 1000) as Time, value: point.value }));
}

export function GreekLineChart({ series, focusSymbol, overlay, overlayPeriod, bollingerMultiplier }: GreekLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRefs = useRef<ISeriesApi<"Line">[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height: 290,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: BORDER },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      lineRefs.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    lineRefs.current.forEach((line) => chart.removeSeries(line));
    lineRefs.current = [];

    Object.entries(series).forEach(([symbol, points], index) => {
      const line = chart.addLineSeries({
        color: COLORS[index % COLORS.length],
        lineWidth: symbol === focusSymbol ? 3 : 2,
        title: symbol,
        lastValueVisible: true,
      });
      line.setData(toChartData(points));
      lineRefs.current.push(line);
    });

    const focusPoints = series[focusSymbol] ?? [];
    const ohlcv: OHLCVData[] = focusPoints.map((point) => ({
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
    }
    chart.timeScale().fitContent();
  }, [series, focusSymbol, overlay, overlayPeriod, bollingerMultiplier]);

  return <div ref={containerRef} className="h-[290px] w-full" aria-label="Selected option Greek chart" />;
}
