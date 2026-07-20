"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { OHLCVData, calculateSMA, calculateEMA, calculateBollingerBands, calculateRSI, calculateSupertrend } from "@/lib/indicators";

interface TradingChartProps {
  data: OHLCVData[];
  liveTick?: { price: number; timestamp: number } | null;
  indicators?: {
    sma?: boolean;
    ema?: boolean;
    bbands?: boolean;
    rsi?: boolean;
    supertrend?: boolean;
  };
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
        textColor: "#a1a1aa", // zinc-400
      },
      grid: {
        vertLines: { color: "#27272a" }, // zinc-800
        horzLines: { color: "#27272a" },
      },
      crosshair: {
        mode: 1, // Normal mode
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#3f3f46", // zinc-700
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      autoSize: true,
    });

    // Candlestick Series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e", // green-500
      downColor: "#ef4444", // red-500
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    // Volume Series
    const volumeSeries = chart.addHistogramSeries({
      color: "#3f3f46", // default volume color
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
      color: d.close >= d.open ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"
    }));
    const uniqueVol = Array.from(new Map(volumeData.map(item => [item.time, item])).values())
      .sort((a, b) => (a.time as number) - (b.time as number));
      
    volumeSeriesRef.current.setData(uniqueVol);

    // --- Indicators ---

    // SMA
    if (indicators?.sma) {
      if (!smaSeriesRef.current) {
        smaSeriesRef.current = chartRef.current.addLineSeries({ color: "#eab308", lineWidth: 2 });
      }
      const smaData = calculateSMA(data, 20).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value
      }));
      smaSeriesRef.current?.setData(smaData);
    } else if (smaSeriesRef.current) {
      chartRef.current.removeSeries(smaSeriesRef.current);
      smaSeriesRef.current = null;
    }

    // EMA
    if (indicators?.ema) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chartRef.current.addLineSeries({ color: "#f97316", lineWidth: 2 });
      }
      const emaData = calculateEMA(data, 20).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value
      }));
      emaSeriesRef.current?.setData(emaData);
    } else if (emaSeriesRef.current) {
      chartRef.current.removeSeries(emaSeriesRef.current);
      emaSeriesRef.current = null;
    }

    // Bollinger Bands
    if (indicators?.bbands) {
      if (!bbUpperRef.current) {
        bbUpperRef.current = chartRef.current.addLineSeries({ color: "rgba(56, 189, 248, 0.5)", lineWidth: 1 });
        bbLowerRef.current = chartRef.current.addLineSeries({ color: "rgba(56, 189, 248, 0.5)", lineWidth: 1 });
      }
      const bbData = calculateBollingerBands(data, 20, 2);
      bbUpperRef.current?.setData(bbData.map(d => ({ time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time, value: d.upper })));
      bbLowerRef.current?.setData(bbData.map(d => ({ time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time, value: d.lower })));
    } else if (bbUpperRef.current && bbLowerRef.current) {
      chartRef.current.removeSeries(bbUpperRef.current);
      chartRef.current.removeSeries(bbLowerRef.current);
      bbUpperRef.current = null;
      bbLowerRef.current = null;
    }

    // Supertrend
    if (indicators?.supertrend) {
      if (!supertrendSeriesRef.current) {
        supertrendSeriesRef.current = chartRef.current.addLineSeries({
          color: "#22c55e",
          lineWidth: 2,
          lineStyle: 2,
        });
      }
      const stData = calculateSupertrend(data, 10, 3).map(d => ({
        time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
        value: d.value,
      }));
      supertrendSeriesRef.current?.setData(stData);
    } else if (supertrendSeriesRef.current) {
      chartRef.current.removeSeries(supertrendSeriesRef.current);
      supertrendSeriesRef.current = null;
    }

  }, [data, indicators?.sma, indicators?.ema, indicators?.bbands, indicators?.supertrend]);

  // RSI Pane Setup
  useEffect(() => {
    if (indicators?.rsi && rsiContainerRef.current) {
      if (!rsiChartRef.current) {
        rsiChartRef.current = createChart(rsiContainerRef.current, {
          height: 150,
          layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
          grid: { vertLines: { color: "#27272a" }, horzLines: { color: "#27272a" } },
          timeScale: { visible: false },
          rightPriceScale: { borderColor: "#3f3f46" },
          autoSize: true,
        });
        
        rsiSeriesRef.current = rsiChartRef.current.addLineSeries({ color: "#a855f7", lineWidth: 2 });
        
        // Add 70 / 30 lines using a very thin series or baseline
        const upperLine = rsiChartRef.current.addLineSeries({ color: "rgba(239, 68, 68, 0.5)", lineWidth: 1, lineStyle: 2 });
        const lowerLine = rsiChartRef.current.addLineSeries({ color: "rgba(34, 197, 94, 0.5)", lineWidth: 1, lineStyle: 2 });
        
        // Sync timeframe with main chart
        if (chartRef.current) {
          chartRef.current.timeScale().subscribeVisibleTimeRangeChange((range) => {
            if (range) rsiChartRef.current?.timeScale().setVisibleRange(range);
          });
        }
      }

      if (data && data.length > 0 && rsiSeriesRef.current) {
        const rsiData = calculateRSI(data, 14).map(d => ({
          time: (typeof d.time === 'string' ? new Date(d.time).getTime() / 1000 : d.time) as Time,
          value: d.value
        }));
        
        const uniqueRsi = Array.from(new Map(rsiData.map(item => [item.time, item])).values())
          .sort((a, b) => (a.time as number) - (b.time as number));
          
        rsiSeriesRef.current.setData(uniqueRsi);
      }
    } else if (!indicators?.rsi && rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    }
  }, [indicators?.rsi, data]);

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

  return (
    <div className="flex w-full flex-col gap-1 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2 shadow-xl">
      {symbol && <div className="px-2 pt-2 text-sm font-bold text-[var(--color-text-bright)]">{symbol} <span className="font-normal text-[var(--color-text-muted)] text-xs ml-2">1m Timeframe</span></div>}
      <div ref={chartContainerRef} className="h-[400px] w-full" />
      {indicators?.rsi && (
        <div className="relative mt-2 border-t border-[var(--color-border-default)]">
          <div className="absolute left-2 top-2 z-10 text-xs font-medium text-[#a855f7]">RSI (14)</div>
          <div ref={rsiContainerRef} className="h-[150px] w-full" />
        </div>
      )}
    </div>
  );
}
