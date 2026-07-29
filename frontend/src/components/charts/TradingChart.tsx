"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { OHLCVData, calculateSMA, calculateEMA, calculateBollingerBands, calculateRSI, calculateSupertrend } from "@/lib/indicators";
import { ChartIndicators, indicatorParameter } from "@/lib/chartIndicators";
import { ChartLegend } from "./ChartLegend";

// lightweight-charts renders to <canvas>, which cannot resolve CSS var() —
// these hex literals mirror the design tokens in globals.css (documented in
// docs/DESIGN_SYSTEM.md). Indicator lines are assigned in one fixed
// categorical order (1st SMA, 2nd EMA, 3rd Bollinger, 4th Supertrend), never
// picked ad hoc per chart.
const COLOR_GRID = "#1e222d"; // --color-border-subtle
const COLOR_BORDER = "#2a2e3e"; // --color-border-default
const COLOR_AXIS_TEXT = "#787b86"; // --color-text-secondary
const COLOR_PROFIT = "#26a69a"; // --color-profit
const COLOR_LOSS = "#ef5350"; // --color-loss
const COLOR_CAT_1 = "#2962ff"; // --color-cat-1 (blue)
const COLOR_CAT_2 = "#ff9800"; // --color-cat-2 (orange)
const COLOR_CAT_3 = "#ab47bc"; // --color-cat-3 (purple)
const COLOR_CAT_4 = "#00bcd4"; // --color-cat-4 (cyan)

interface TradingChartProps {
  data: OHLCVData[];
  liveTick?: { price: number; timestamp: number } | null;
  indicators?: ChartIndicators;
  symbol?: string;
}

export function TradingChart({ data, liveTick, indicators, symbol }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  
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
      },
      rightPriceScale: {
        borderColor: COLOR_BORDER,
      },
      autoSize: true,
    });

    // Candlestick Series
    const candleSeries = chart.addCandlestickSeries({
      upColor: COLOR_PROFIT,
      downColor: COLOR_LOSS,
      borderVisible: false,
      wickUpColor: COLOR_PROFIT,
      wickDownColor: COLOR_LOSS,
    });

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
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
    };
  }, []);

  // Update Data and Indicators
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current || !data || data.length === 0) return;

    const formattedData = data.map(d => ({
      time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    
    // De-duplicate times
    const uniqueData = Array.from(new Map(formattedData.map(item => [item.time, item])).values())
      .sort((a, b) => (a.time as number) - (b.time as number));

    candleSeriesRef.current.setData(uniqueData);

    const volumeData = data.map(d => ({
      time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
      value: d.volume || 0,
      color: d.close >= d.open ? `${COLOR_PROFIT}4D` : `${COLOR_LOSS}4D` // ~30% opacity
    }));
    const uniqueVol = Array.from(new Map(volumeData.map(item => [item.time, item])).values())
      .sort((a, b) => (a.time as number) - (b.time as number));
      
    volumeSeriesRef.current.setData(uniqueVol);

    // --- Indicators ---

    // SMA
    if (indicators?.sma.enabled) {
      if (!smaSeriesRef.current) {
        smaSeriesRef.current = chartRef.current.addLineSeries({ color: COLOR_CAT_1, lineWidth: 2 });
      }
      const smaData = calculateSMA(data, indicatorParameter(indicators, "sma", "period")).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value
      }));
      smaSeriesRef.current?.setData(smaData);
    } else if (smaSeriesRef.current) {
      chartRef.current.removeSeries(smaSeriesRef.current);
      smaSeriesRef.current = null;
    }

    // EMA
    if (indicators?.ema.enabled) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chartRef.current.addLineSeries({ color: COLOR_CAT_2, lineWidth: 2 });
      }
      const emaData = calculateEMA(data, indicatorParameter(indicators, "ema", "period")).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value
      }));
      emaSeriesRef.current?.setData(emaData);
    } else if (emaSeriesRef.current) {
      chartRef.current.removeSeries(emaSeriesRef.current);
      emaSeriesRef.current = null;
    }

    // Bollinger Bands
    if (indicators?.bbands.enabled) {
      if (!bbUpperRef.current) {
        bbUpperRef.current = chartRef.current.addLineSeries({ color: `${COLOR_CAT_3}80`, lineWidth: 1 });
        bbLowerRef.current = chartRef.current.addLineSeries({ color: `${COLOR_CAT_3}80`, lineWidth: 1 });
      }
      const bbData = calculateBollingerBands(
        data,
        indicatorParameter(indicators, "bbands", "period"),
        indicatorParameter(indicators, "bbands", "multiplier")
      );
      bbUpperRef.current?.setData(bbData.map(d => ({ time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time, value: d.upper })));
      bbLowerRef.current?.setData(bbData.map(d => ({ time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time, value: d.lower })));
    } else if (bbUpperRef.current && bbLowerRef.current) {
      chartRef.current.removeSeries(bbUpperRef.current);
      chartRef.current.removeSeries(bbLowerRef.current);
      bbUpperRef.current = null;
      bbLowerRef.current = null;
    }

    // Supertrend
    if (indicators?.supertrend.enabled) {
      if (!supertrendSeriesRef.current) {
        supertrendSeriesRef.current = chartRef.current.addLineSeries({
          color: COLOR_CAT_4,
          lineWidth: 2,
          lineStyle: 2,
        });
      }
      const stData = calculateSupertrend(
        data,
        indicatorParameter(indicators, "supertrend", "period"),
        indicatorParameter(indicators, "supertrend", "multiplier")
      ).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value,
      }));
      supertrendSeriesRef.current?.setData(stData);
    } else if (supertrendSeriesRef.current) {
      chartRef.current.removeSeries(supertrendSeriesRef.current);
      supertrendSeriesRef.current = null;
    }

  }, [data, indicators]);

  // RSI Pane Setup
  useEffect(() => {
    if (indicators?.rsi.enabled && rsiContainerRef.current) {
      if (!rsiChartRef.current) {
        rsiChartRef.current = createChart(rsiContainerRef.current, {
          height: 150,
          layout: { background: { color: "transparent" }, textColor: COLOR_AXIS_TEXT },
          grid: { vertLines: { color: COLOR_GRID }, horzLines: { color: COLOR_GRID } },
          timeScale: { visible: false },
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

      if (data && data.length > 0 && rsiSeriesRef.current) {
        const rsiData = calculateRSI(data, indicatorParameter(indicators, "rsi", "period")).map(d => ({
          time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
          value: d.value
        }));
        
        const uniqueRsi = Array.from(new Map(rsiData.map(item => [item.time, item])).values())
          .sort((a, b) => (a.time as number) - (b.time as number));
          
        rsiSeriesRef.current.setData(uniqueRsi);
      }
    } else if (!indicators?.rsi.enabled && rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    }
  }, [indicators, data]);

  // Live Tick Updates
  useEffect(() => {
    if (liveTick && candleSeriesRef.current && data && data.length > 0) {
      // Very basic live update: we just update the last candle's close and high/low
      // In a real app, we need to handle new minute candles forming.
      const lastCandle = data[data.length - 1];
      const time = (typeof lastCandle.time === 'string' ? new Date(lastCandle.time).getTime() / 1000 : lastCandle.time) as Time;
      
      const newHigh = Math.max(lastCandle.high, liveTick.price);
      const newLow = Math.min(lastCandle.low, liveTick.price);
      
      candleSeriesRef.current.update({
        time,
        open: lastCandle.open,
        high: newHigh,
        low: newLow,
        close: liveTick.price,
      });
    }
  }, [liveTick]); // Deliberately omit data to avoid full redraws on ticks

  const legendItems = [
    indicators?.sma.enabled && { label: `SMA (${indicatorParameter(indicators, "sma", "period")})`, color: COLOR_CAT_1 },
    indicators?.ema.enabled && { label: `EMA (${indicatorParameter(indicators, "ema", "period")})`, color: COLOR_CAT_2 },
    indicators?.bbands.enabled && { label: `Bollinger (${indicatorParameter(indicators, "bbands", "period")}, ${indicatorParameter(indicators, "bbands", "multiplier")})`, color: COLOR_CAT_3 },
    indicators?.supertrend.enabled && { label: `Supertrend (${indicatorParameter(indicators, "supertrend", "period")}, ${indicatorParameter(indicators, "supertrend", "multiplier")})`, color: COLOR_CAT_4 },
  ].filter((item): item is { label: string; color: string } => Boolean(item));

  return (
    <div className="panel flex w-full flex-col gap-1 p-2">
      {symbol && <div className="px-2 pt-2 text-sm font-bold text-[var(--color-text-bright)]">{symbol} <span className="font-normal text-[var(--color-text-muted)] text-xs ml-2">1m Timeframe</span></div>}
      <ChartLegend items={legendItems} />
      <div ref={chartContainerRef} className="h-[400px] w-full" />
      {indicators?.rsi.enabled && (
        <div className="relative mt-2 border-t border-[var(--color-border-default)]">
          <div className="absolute left-2 top-2 z-10 text-xs font-medium" style={{ color: COLOR_CAT_1 }}>RSI ({indicatorParameter(indicators, "rsi", "period")})</div>
          <div ref={rsiContainerRef} className="h-[150px] w-full" />
        </div>
      )}
    </div>
  );
}
