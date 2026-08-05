"use client";

import { useCallback, useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time } from "lightweight-charts";
import { calculateBollingerBands, calculateEMA, calculateSMA, calculateSupertrend, type OHLCVData } from "@/lib/indicators";
import { supertrendColor, SUPERTREND_UP_COLOR } from "@/lib/supertrendColors";
import { MARKET_CHART_LOCALIZATION, formatMarketTick, timeToDate } from "@/lib/chartTime";
import { useGreekChartSync } from "@/components/greek-workspace/GreekChartSyncProvider";
import { ChartZoomControls } from "@/components/charts/ChartZoomControls";
import { zoomLightweightChart } from "@/lib/lightweightChartZoom";
import type { GreekMetric, GreekPoint } from "@/lib/strikeGreekAnalysis";

const GRID = "#1e222d";
const BORDER = "#2a2e3e";
const TEXT = "#787b86";

export type GreekOverlay = "none" | "sma" | "ema" | "bbands" | "supertrend";

interface GreekLineChartProps {
  metric: GreekMetric;
  points: GreekPoint[];
  overlay: GreekOverlay;
  overlayPeriod: number;
  bollingerMultiplier: number;
  syncId: string;
}

// Rho is quoted per one percentage-point rate move. For near-expiry index
// options that can be only a few thousandths, which the chart's default
// two-decimal formatter collapses to `0.0` on the price axis. Keep the
// calculation unchanged and give this metric enough display precision.
const RHO_PRICE_FORMAT = { type: "price" as const, precision: 4, minMove: 0.0001 };

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

function timeKey(time: Time): number | null {
  const date = timeToDate(time);
  return date ? date.getTime() / 1000 : null;
}

function nearestValue(values: Map<number, number>, time: Time): number | null {
  const target = timeKey(time);
  if (target === null || values.size === 0) return null;
  const exact = values.get(target);
  if (exact !== undefined) return exact;

  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const [candidateTime, value] of values) {
    const candidateDistance = Math.abs(candidateTime - target);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = value;
    }
  }
  return nearest;
}

export function GreekLineChart({ metric, points, overlay, overlayPeriod, bollingerMultiplier, syncId }: GreekLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRefs = useRef<ISeriesApi<"Line">[]>([]);
  const crosshairValuesRef = useRef(new Map<number, number>());
  const { registerChart, notifyTimeRange, notifyCrosshair } = useGreekChartSync();

  const applyCrosshair = useCallback((time: Time | null) => {
    const chart = chartRef.current;
    const series = lineRefs.current[0];
    if (!chart || !series || time === null) {
      chart?.clearCrosshairPosition();
      return;
    }
    const value = nearestValue(crosshairValuesRef.current, time);
    if (value === null) {
      chart.clearCrosshairPosition();
      return;
    }
    chart.setCrosshairPosition(value, time, series);
  }, []);

  const resetChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
    notifyTimeRange(syncId, chart.timeScale().getVisibleRange());
  }, [notifyTimeRange, syncId]);
  const zoomChart = useCallback((direction: "in" | "out") => {
    zoomLightweightChart(chartRef.current, direction);
    const range = chartRef.current?.timeScale().getVisibleRange();
    if (range) notifyTimeRange(syncId, range);
  }, [notifyTimeRange, syncId]);

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
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      notifyCrosshair(syncId, param.time ?? null);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
    chart.subscribeCrosshairMove(onCrosshairMove);
    const unregisterChart = registerChart(syncId, chart, applyCrosshair);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      unregisterChart();
      chart.remove();
      chartRef.current = null;
      lineRefs.current = [];
    };
  }, [applyCrosshair, notifyCrosshair, notifyTimeRange, registerChart, syncId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const visibleRange = chart.timeScale().getVisibleRange();
    lineRefs.current.forEach((line) => chart.removeSeries(line));
    lineRefs.current = [];

    const normalizedPoints = normalizePoints(points);
    crosshairValuesRef.current = new Map(
      toChartData(normalizedPoints)
        .map((point) => [timeKey(point.time), point.value] as const)
        .filter((entry): entry is readonly [number, number] => entry[0] !== null),
    );
    const priceFormat = metric === "rho" ? RHO_PRICE_FORMAT : undefined;
    const combined = chart.addLineSeries({
      color: "#2962ff",
      lineWidth: 3,
      title: "Combined",
      lastValueVisible: true,
      priceFormat,
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
      const line = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, lineStyle: 2, title: `SMA ${overlayPeriod}`, priceFormat });
      line.setData(calculateSMA(ohlcv, overlayPeriod).map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.value })));
      lineRefs.current.push(line);
    } else if (overlay === "ema") {
      const line = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, lineStyle: 2, title: `EMA ${overlayPeriod}`, priceFormat });
      line.setData(calculateEMA(ohlcv, overlayPeriod).map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.value })));
      lineRefs.current.push(line);
    } else if (overlay === "bbands") {
      const bands = calculateBollingerBands(ohlcv, overlayPeriod, bollingerMultiplier);
      const upper = chart.addLineSeries({ color: "#ab47bc", lineWidth: 1, lineStyle: 2, title: "BB upper", priceFormat });
      const lower = chart.addLineSeries({ color: "#ab47bc", lineWidth: 1, lineStyle: 2, title: "BB lower", priceFormat });
      upper.setData(bands.map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.upper })));
      lower.setData(bands.map((point) => ({ time: (new Date(String(point.time)).getTime() / 1000) as Time, value: point.lower })));
      lineRefs.current.push(upper, lower);
    } else if (overlay === "supertrend") {
      const line = chart.addLineSeries({
        color: SUPERTREND_UP_COLOR,
        lineWidth: 2,
        title: `Supertrend ${overlayPeriod} × ${bollingerMultiplier}`,
        priceFormat,
      });
      line.setData(calculateSupertrend(ohlcv, overlayPeriod, bollingerMultiplier).map((point) => ({
        time: (new Date(String(point.time)).getTime() / 1000) as Time,
        value: point.value,
        color: supertrendColor(point.trend),
      })));
      lineRefs.current.push(line);
    }
    if (visibleRange) chart.timeScale().setVisibleRange(visibleRange);
    else chart.timeScale().fitContent();
  }, [metric, points, overlay, overlayPeriod, bollingerMultiplier]);

  return <div className="relative"><div className="absolute right-2 top-2 z-10"><ChartZoomControls label={`${metric} Greek chart`} onZoomIn={() => zoomChart("in")} onZoomOut={() => zoomChart("out")} onReset={resetChartView} /></div><div ref={containerRef} className="h-[290px] w-full" aria-label="Selected option Greek chart" title="Right-click to reset chart view" onContextMenu={(event) => { event.preventDefault(); resetChartView(); }} /></div>;
}
