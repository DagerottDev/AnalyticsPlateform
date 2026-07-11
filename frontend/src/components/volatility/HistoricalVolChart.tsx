"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { VolatilityHistoricalData } from "@/lib/volatility";

interface HistoricalVolChartProps {
  data: VolatilityHistoricalData[];
}

export function HistoricalVolChart({ data }: HistoricalVolChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const ivSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rvSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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
        timeVisible: false,
        borderColor: "#3f3f46", // zinc-700
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      autoSize: true,
    });

    const ivSeries = chart.addLineSeries({
      color: "#a855f7", // purple
      lineWidth: 2,
      title: "Implied Volatility",
    });

    const rvSeries = chart.addLineSeries({
      color: "#f97316", // orange
      lineWidth: 2,
      title: "Realized Volatility",
    });

    chartRef.current = chart;
    ivSeriesRef.current = ivSeries;
    rvSeriesRef.current = rvSeries;

    return () => {
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !ivSeriesRef.current || !rvSeriesRef.current || !data || data.length === 0) return;

    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const ivData = sortedData.map(d => ({
      time: (new Date(d.date).getTime() / 1000) as Time,
      value: d.iv * 100
    }));

    const rvData = sortedData.map(d => ({
      time: (new Date(d.date).getTime() / 1000) as Time,
      value: d.rv * 100
    }));

    // Dedup
    const uniqueIvData = Array.from(new Map(ivData.map(item => [item.time, item])).values());
    const uniqueRvData = Array.from(new Map(rvData.map(item => [item.time, item])).values());

    ivSeriesRef.current.setData(uniqueIvData);
    rvSeriesRef.current.setData(uniqueRvData);
    
    chartRef.current.timeScale().fitContent();
  }, [data]);

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Historical IV vs RV (1 Year)</h3>
      <div ref={chartContainerRef} className="h-[300px] w-full" />
    </div>
  );
}
