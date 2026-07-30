"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { MARKET_CHART_LOCALIZATION, formatMarketTick } from "@/lib/chartTime";
import { VolatilityHistoricalData } from "@/lib/volatility";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { ChartDataTable } from "@/components/charts/ChartDataTable";

// lightweight-charts renders to <canvas>, which cannot resolve CSS var() —
// these hex literals mirror the design tokens in globals.css. Fixed
// categorical order: 1st series = blue, 2nd = orange.
const COLOR_GRID = "#1e222d"; // --color-border-subtle
const COLOR_BORDER = "#2a2e3e"; // --color-border-default
const COLOR_AXIS_TEXT = "#787b86"; // --color-text-secondary
const COLOR_CAT_1 = "#2962ff"; // --color-cat-1 (blue) — Implied Volatility
const COLOR_CAT_2 = "#ff9800"; // --color-cat-2 (orange) — Realized Volatility

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
        timeVisible: false,
        borderColor: COLOR_BORDER,
        tickMarkFormatter: formatMarketTick,
      },
      localization: MARKET_CHART_LOCALIZATION,
      rightPriceScale: {
        borderColor: COLOR_BORDER,
      },
      autoSize: true,
    });

    const ivSeries = chart.addLineSeries({
      color: COLOR_CAT_1,
      lineWidth: 2,
      title: "Implied Volatility",
    });

    const rvSeries = chart.addLineSeries({
      color: COLOR_CAT_2,
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

  const tableRows = [...data]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((point) => ({ date: point.date, iv: `${(point.iv * 100).toFixed(2)}%`, rv: `${(point.rv * 100).toFixed(2)}%` }));

  return (
    <div className="panel flex w-full flex-col gap-2">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Historical IV vs RV (1 Year)</h3>
      <ChartLegend
        items={[
          { label: "Implied Volatility", color: COLOR_CAT_1 },
          { label: "Realized Volatility", color: COLOR_CAT_2 },
        ]}
      />
      <div
        ref={chartContainerRef}
        role="img"
        aria-label={`Historical implied versus realized volatility line chart with ${data.length} daily observations. Exact values are available in the following data table.`}
        className="h-[300px] w-full"
      />
      <ChartDataTable
        title="historical volatility"
        summary={`${data.length} daily implied-volatility and realized-volatility observations.`}
        columns={[{ key: "date", label: "Date" }, { key: "iv", label: "Implied volatility" }, { key: "rv", label: "Realized volatility" }]}
        rows={tableRows}
      />
    </div>
  );
}
