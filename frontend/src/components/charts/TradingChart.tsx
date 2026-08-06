"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, Time, type MouseEventParams } from "lightweight-charts";
import { OHLCVData, calculateSMA, calculateEMA, calculateBollingerBands, calculateRSI, calculateSupertrend } from "@/lib/indicators";
import { ChartIndicators, indicatorParameter } from "@/lib/chartIndicators";
import { mergeLiveCandle, normalizeOHLCVData, sortAndDeduplicateChartData } from "@/lib/chartData";
import { supertrendColor, SUPERTREND_DOWN_COLOR, SUPERTREND_UP_COLOR } from "@/lib/supertrendColors";
import { formatMarketDateTime, MARKET_CHART_LOCALIZATION, formatMarketTick, timeToUnixSeconds } from "@/lib/chartTime";
import { ChartLegend } from "./ChartLegend";
import { ChartDataTable } from "./ChartDataTable";
import { ChartZoomControls } from "./ChartZoomControls";
import { useGreekChartSync } from "@/components/greek-workspace/GreekChartSyncProvider";
import { zoomLightweightChart } from "@/lib/lightweightChartZoom";

// lightweight-charts renders to <canvas>, which cannot resolve CSS var() —
// these hex literals mirror the design tokens in globals.css (documented in
// docs/DESIGN_SYSTEM.md). Indicator lines use a fixed categorical order;
// Supertrend is the exception because its color encodes bullish/bearish state.
const COLOR_GRID = "#1e222d"; // --color-border-subtle
const COLOR_BORDER = "#2a2e3e"; // --color-border-default
const COLOR_AXIS_TEXT = "#787b86"; // --color-text-secondary
const COLOR_PROFIT = "#26a69a"; // --color-profit
const COLOR_LOSS = "#ef5350"; // --color-loss
const COLOR_CAT_1 = "#2962ff"; // --color-cat-1 (blue)
const COLOR_CAT_2 = "#ff9800"; // --color-cat-2 (orange)
const COLOR_CAT_3 = "#ab47bc"; // --color-cat-3 (purple)

function nearestValue(values: Map<number, number>, time: Time): number | null {
  const target = timeToUnixSeconds(time);
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

function removeLineSeries(
  chart: IChartApi,
  seriesRef: { current: ISeriesApi<"Line"> | null },
): void {
  const series = seriesRef.current;
  if (!series) return;
  try {
    chart.removeSeries(series);
  } catch {
    // The chart may have been removed between effects; there is nothing left
    // to clean up in that case.
  } finally {
    seriesRef.current = null;
  }
}

interface TradingChartProps {
  data: OHLCVData[];
  liveTick?: { price: number; timestamp: number } | null;
  indicators?: ChartIndicators;
  symbol?: string;
  timeframeLabel?: string;
  /** Registers the chart with a workspace-level time/zoom/crosshair synchronizer. */
  syncId?: string;
  /** Reports the hovered candle time in Unix seconds, including null on exit. */
  onCrosshairTimeChange?: (time: number | null) => void;
  /** Candles show the full broker OHLC range; line uses only each close. */
  seriesType?: "candlestick" | "line";
}

export function TradingChart({ data, liveTick, indicators, symbol, timeframeLabel = "1m", syncId, onCrosshairTimeChange, seriesType = "candlestick" }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const closeSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const latestDataRef = useRef(data);
  
  // Indicator series refs
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const supertrendSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  
  // RSI Chart refs (separate pane)
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const crosshairValuesRef = useRef(new Map<number, number>());
  const onCrosshairTimeChangeRef = useRef(onCrosshairTimeChange);
  onCrosshairTimeChangeRef.current = onCrosshairTimeChange;
  const { registerChart, notifyTimeRange, notifyCrosshair } = useGreekChartSync();
  const liveData = useMemo(
    () => mergeLiveCandle(data, liveTick),
    [data, liveTick],
  );

  const applyCrosshair = useCallback((time: Time | null) => {
    const chart = chartRef.current;
    if (!chart || time === null) {
      chart?.clearCrosshairPosition();
      return;
    }
    const value = nearestValue(crosshairValuesRef.current, time);
    if (value === null) {
      chart.clearCrosshairPosition();
      return;
    }
    if (seriesType === "candlestick" && candleSeriesRef.current) {
      chart.setCrosshairPosition(value, time, candleSeriesRef.current);
    } else if (seriesType === "line" && closeSeriesRef.current) {
      chart.setCrosshairPosition(value, time, closeSeriesRef.current);
    } else {
      chart.clearCrosshairPosition();
    }
  }, [seriesType]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize main chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: COLOR_AXIS_TEXT,
      },
      grid: {
        vertLines: { color: COLOR_GRID },
        horzLines: { color: COLOR_GRID },
      },
      crosshair: {
        mode: 1, // Normal mode
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: COLOR_BORDER,
        tickMarkFormatter: formatMarketTick,
      },
      localization: MARKET_CHART_LOCALIZATION,
      rightPriceScale: {
        borderColor: COLOR_BORDER,
      },
      autoSize: true,
    });

    const candleSeries = seriesType === "candlestick" ? chart.addCandlestickSeries({
      upColor: COLOR_PROFIT,
      downColor: COLOR_LOSS,
      borderVisible: false,
      wickUpColor: COLOR_PROFIT,
      wickDownColor: COLOR_LOSS,
    }) : null;
    const closeSeries = seriesType === "line" ? chart.addLineSeries({
      color: COLOR_CAT_1,
      lineWidth: 2,
      crosshairMarkerVisible: true,
    }) : null;

    // Volume Series
    const volumeSeries = chart.addHistogramSeries({
      color: COLOR_BORDER, // default volume color
      priceFormat: { type: "volume" },
      priceScaleId: "", // set as an overlay by setting a blank priceScaleId
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    closeSeriesRef.current = closeSeries;
    volumeSeriesRef.current = volumeSeries;

    const onVisibleTimeRangeChange = (range: Parameters<typeof notifyTimeRange>[1]) => {
      if (syncId) notifyTimeRange(syncId, range);
    };
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const time = param.time ?? null;
      if (syncId) notifyCrosshair(syncId, time);
      onCrosshairTimeChangeRef.current?.(time === null ? null : timeToUnixSeconds(time));
    };
    if (syncId) chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
    chart.subscribeCrosshairMove(onCrosshairMove);
    const unregisterChart = syncId ? registerChart(syncId, chart, applyCrosshair) : () => undefined;

    return () => {
      if (syncId) chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      unregisterChart();
      chart.remove();
      // React Strict Mode and fast refresh can dispose a chart and then run a
      // dependent effect once more. Clear every ref so that effect cannot
      // call removeSeries/setData on a disposed Lightweight Charts instance.
      if (chartRef.current === chart) {
        chartRef.current = null;
        candleSeriesRef.current = null;
        closeSeriesRef.current = null;
        volumeSeriesRef.current = null;
        smaSeriesRef.current = null;
        emaSeriesRef.current = null;
        bbUpperRef.current = null;
        bbLowerRef.current = null;
        supertrendSeriesRef.current = null;
        crosshairValuesRef.current.clear();
      }
    };
  }, [applyCrosshair, notifyCrosshair, notifyTimeRange, registerChart, seriesType, syncId]);

  // Update the historical chart data. Live ticks are applied with update()
  // below so frequent quotes do not rebuild the full candle series.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || (!candleSeriesRef.current && !closeSeriesRef.current) || !volumeSeriesRef.current || !data || data.length === 0) return;

    const normalizedData = normalizeOHLCVData(data);
    crosshairValuesRef.current = new Map(
      normalizedData
        .map((point) => [timeToUnixSeconds(point.time as Time), point.close] as const)
        .filter((entry): entry is readonly [number, number] => entry[0] !== null),
    );
    const formattedData = normalizedData.map(d => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    if (seriesType === "candlestick") {
      candleSeriesRef.current?.setData(formattedData);
    } else {
      closeSeriesRef.current?.setData(normalizedData.map((point) => ({ time: point.time as Time, value: point.close })));
    }

    const volumeData = normalizedData.map(d => ({
      time: d.time as Time,
      value: d.volume || 0,
      color: d.close >= d.open ? `${COLOR_PROFIT}4D` : `${COLOR_LOSS}4D` // ~30% opacity
    }));
    volumeSeriesRef.current.setData(volumeData);

    // setData may change the available time range. Let the workspace use the
    // first chart's resulting range as the canonical horizontal scale.
    if (syncId) {
      queueMicrotask(() => {
        if (chartRef.current !== chart) return;
        const range = chart.timeScale().getVisibleRange();
        if (range) notifyTimeRange(syncId, range);
      });
    }
  }, [data, notifyTimeRange, seriesType, syncId]);

  // Recalculate indicators from the historical series plus the current live
  // price. This keeps EMA/SMA/Bollinger/Supertrend/RSI aligned with the price
  // shown on the live composite candle without rebuilding the candle series.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data || data.length === 0 || !indicators) return;

    const indicatorData = liveData;

    // --- Indicators ---

    // SMA
    if (indicators.sma.enabled) {
      if (!smaSeriesRef.current) {
        smaSeriesRef.current = chart.addLineSeries({ color: COLOR_CAT_1, lineWidth: 2 });
      }
      const smaData = sortAndDeduplicateChartData(
        calculateSMA(indicatorData, indicatorParameter(indicators, "sma", "period"))
      ).map(d => ({
        time: d.time as Time,
        value: d.value
      }));
      smaSeriesRef.current?.setData(smaData);
    } else if (smaSeriesRef.current) {
      removeLineSeries(chart, smaSeriesRef);
    }

    // EMA
    if (indicators.ema.enabled) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chart.addLineSeries({ color: COLOR_CAT_2, lineWidth: 2 });
      }
      const emaData = sortAndDeduplicateChartData(
        calculateEMA(indicatorData, indicatorParameter(indicators, "ema", "period"))
      ).map(d => ({
        time: d.time as Time,
        value: d.value
      }));
      emaSeriesRef.current?.setData(emaData);
    } else if (emaSeriesRef.current) {
      removeLineSeries(chart, emaSeriesRef);
    }

    // Bollinger Bands
    if (indicators.bbands.enabled) {
      if (!bbUpperRef.current) {
        bbUpperRef.current = chart.addLineSeries({ color: `${COLOR_CAT_3}80`, lineWidth: 1 });
        bbLowerRef.current = chart.addLineSeries({ color: `${COLOR_CAT_3}80`, lineWidth: 1 });
      }
      const bbData = calculateBollingerBands(
        indicatorData,
        indicatorParameter(indicators, "bbands", "period"),
        indicatorParameter(indicators, "bbands", "multiplier")
      );
      bbUpperRef.current?.setData(sortAndDeduplicateChartData(bbData).map(d => ({ time: d.time as Time, value: d.upper })));
      bbLowerRef.current?.setData(sortAndDeduplicateChartData(bbData).map(d => ({ time: d.time as Time, value: d.lower })));
    } else if (bbUpperRef.current && bbLowerRef.current) {
      removeLineSeries(chart, bbUpperRef);
      removeLineSeries(chart, bbLowerRef);
    }

    // Supertrend
    if (indicators.supertrend.enabled) {
      if (!supertrendSeriesRef.current) {
        supertrendSeriesRef.current = chart.addLineSeries({
          color: SUPERTREND_UP_COLOR,
          lineWidth: 2,
        });
      }
      const supertrendData = calculateSupertrend(
        indicatorData,
        indicatorParameter(indicators, "supertrend", "period"),
        indicatorParameter(indicators, "supertrend", "multiplier")
      );
      const stData = sortAndDeduplicateChartData(supertrendData).map(d => ({
        time: d.time as Time,
        value: d.value,
        color: supertrendColor(d.trend),
      }));
      supertrendSeriesRef.current?.setData(stData);
    } else if (supertrendSeriesRef.current) {
      removeLineSeries(chart, supertrendSeriesRef);
    }

    if (syncId) {
      queueMicrotask(() => {
        if (chartRef.current !== chart) return;
        const range = chart.timeScale().getVisibleRange();
        if (range) notifyTimeRange(syncId, range);
      });
    }
  }, [data, indicators, liveData, notifyTimeRange, seriesType, syncId]);

  // RSI Pane Setup
  useEffect(() => {
    if (indicators?.rsi.enabled && rsiContainerRef.current) {
      if (!rsiChartRef.current) {
        rsiChartRef.current = createChart(rsiContainerRef.current, {
          height: 150,
          layout: { background: { color: "transparent" }, textColor: COLOR_AXIS_TEXT },
          grid: { vertLines: { color: COLOR_GRID }, horzLines: { color: COLOR_GRID } },
          timeScale: { visible: false, tickMarkFormatter: formatMarketTick },
          localization: MARKET_CHART_LOCALIZATION,
          rightPriceScale: { borderColor: COLOR_BORDER },
          autoSize: true,
        });

        rsiSeriesRef.current = rsiChartRef.current.addLineSeries({ color: COLOR_CAT_1, lineWidth: 2 });

        // 70 / 30 overbought/oversold threshold lines — status-like, not
        // categorical, so they use the profit/loss pair rather than a cat slot.
        rsiChartRef.current.addLineSeries({ color: `${COLOR_LOSS}80`, lineWidth: 1, lineStyle: 2 });
        rsiChartRef.current.addLineSeries({ color: `${COLOR_PROFIT}80`, lineWidth: 1, lineStyle: 2 });

        // Sync timeframe with main chart
        if (chartRef.current) {
          chartRef.current.timeScale().subscribeVisibleTimeRangeChange((range) => {
            if (range) rsiChartRef.current?.timeScale().setVisibleRange(range);
          });
        }
      }

      if (liveData.length > 0 && rsiSeriesRef.current) {
        const rsiData = sortAndDeduplicateChartData(
          calculateRSI(liveData, indicatorParameter(indicators, "rsi", "period"))
        ).map(d => ({
          time: d.time as Time,
          value: d.value
        }));

        rsiSeriesRef.current.setData(rsiData);
      }
    } else if (!indicators?.rsi.enabled && rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    }
  }, [indicators, liveData]);

  useEffect(() => {
    latestDataRef.current = normalizeOHLCVData(data);
  }, [data]);

  const resetChartView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().fitContent();
    rsiChartRef.current?.timeScale().fitContent();
    if (syncId) notifyTimeRange(syncId, chart.timeScale().getVisibleRange());
  }, [notifyTimeRange, syncId]);
  const zoomChart = useCallback((direction: "in" | "out") => {
    zoomLightweightChart(chartRef.current, direction);
    const range = chartRef.current?.timeScale().getVisibleRange();
    if (syncId && range) notifyTimeRange(syncId, range);
  }, [notifyTimeRange, syncId]);

  // Live ticks must retain the newest candle without rebuilding the chart.
  useEffect(() => {
    const latestData = latestDataRef.current;
    if (liveTick && latestData.length > 0) {
      // Very basic live update: we just update the last candle's close and high/low
      // In a real app, we need to handle new minute candles forming.
      const lastCandle = latestData[latestData.length - 1];
      const time = (typeof lastCandle.time === 'string' ? new Date(lastCandle.time).getTime() / 1000 : lastCandle.time) as Time;
      
      const newHigh = Math.max(lastCandle.high, liveTick.price);
      const newLow = Math.min(lastCandle.low, liveTick.price);
      const seconds = timeToUnixSeconds(time);
      if (seconds !== null) crosshairValuesRef.current.set(seconds, liveTick.price);
      
      if (seriesType === "candlestick") {
        candleSeriesRef.current?.update({
          time,
          open: lastCandle.open,
          high: newHigh,
          low: newLow,
          close: liveTick.price,
        });
      } else {
        closeSeriesRef.current?.update({ time, value: liveTick.price });
      }
    }
  }, [liveTick, seriesType]);

  const legendItems = [
    indicators?.sma.enabled && { label: `SMA (${indicatorParameter(indicators, "sma", "period")})`, color: COLOR_CAT_1 },
    indicators?.ema.enabled && { label: `EMA (${indicatorParameter(indicators, "ema", "period")})`, color: COLOR_CAT_2 },
    indicators?.bbands.enabled && { label: `Bollinger (${indicatorParameter(indicators, "bbands", "period")}, ${indicatorParameter(indicators, "bbands", "multiplier")})`, color: COLOR_CAT_3 },
    indicators?.supertrend.enabled && { label: "Supertrend bullish", color: SUPERTREND_UP_COLOR },
    indicators?.supertrend.enabled && { label: "Supertrend bearish", color: SUPERTREND_DOWN_COLOR },
  ].filter((item): item is { label: string; color: string } => Boolean(item));

  const formatTime = (time: OHLCVData["time"]) => {
    const marketTime = formatMarketDateTime(time as Time);
    return marketTime || String(time);
  };
  const chartRows = liveData.map((point) => ({
    time: formatTime(point.time),
    open: point.open.toFixed(2),
    high: point.high.toFixed(2),
    low: point.low.toFixed(2),
    close: point.close.toFixed(2),
    volume: point.volume?.toLocaleString() ?? "—",
  }));

  return (
    <div className="panel flex w-full flex-col gap-1 p-2">
      <div className="flex items-center justify-between gap-2 px-2 pt-2">{symbol && <div className="text-sm font-bold text-[var(--color-text-bright)]">{symbol} <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{timeframeLabel} Timeframe</span></div>}<ChartZoomControls label={symbol ?? "chart"} onZoomIn={() => zoomChart("in")} onZoomOut={() => zoomChart("out")} onReset={resetChartView} /></div>
      <ChartLegend items={legendItems} />
      <div
        ref={chartContainerRef}
        role="img"
        aria-label={`${symbol ?? "Instrument"} ${timeframeLabel} ${seriesType === "line" ? "close-price line" : "candlestick"} chart with ${liveData.length} candles. Use the following data table for exact OHLC and volume values.`}
        title="Right-click to reset chart view"
        onContextMenu={(event) => { event.preventDefault(); resetChartView(); }}
        className="h-[400px] w-full"
      />
      <ChartDataTable
        className="px-2"
        title={`${symbol ?? "Instrument"} OHLCV`}
        summary={`${liveData.length} ${timeframeLabel} candles. Values are ordered from oldest to newest.`}
        columns={[
          { key: "time", label: "Time" }, { key: "open", label: "Open" }, { key: "high", label: "High" },
          { key: "low", label: "Low" }, { key: "close", label: "Close" }, { key: "volume", label: "Volume" },
        ]}
        rows={chartRows}
      />
      {indicators?.rsi.enabled && (
        <div className="relative mt-2 border-t border-[var(--color-border-default)]">
          <div className="absolute left-2 top-2 z-10 text-xs font-medium" style={{ color: COLOR_CAT_1 }}>RSI ({indicatorParameter(indicators, "rsi", "period")})</div>
          <div
            ref={rsiContainerRef}
            role="img"
            aria-label={`RSI chart using a ${indicatorParameter(indicators, "rsi", "period")}-period calculation. Exact values are available in the following data table.`}
            title="Right-click to reset chart view"
            onContextMenu={(event) => { event.preventDefault(); resetChartView(); }}
            className="h-[150px] w-full"
          />
          <ChartDataTable
            className="px-2 pb-2"
            title="RSI"
            summary={`RSI values for the same ${liveData.length} candles.`}
            columns={[{ key: "time", label: "Time" }, { key: "rsi", label: "RSI" }]}
            rows={calculateRSI(liveData, indicatorParameter(indicators, "rsi", "period")).map((point) => ({ time: formatTime(point.time), rsi: point.value.toFixed(2) }))}
          />
        </div>
      )}
    </div>
  );
}
