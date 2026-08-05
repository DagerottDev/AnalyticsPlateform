"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Range, type Time } from "lightweight-charts";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { ChartZoomControls } from "@/components/charts/ChartZoomControls";
import { EmptyState } from "@/components/ui/EmptyState";
import { MARKET_CHART_LOCALIZATION, formatMarketTick } from "@/lib/chartTime";
import { zoomLightweightChart } from "@/lib/lightweightChartZoom";
import { hasFullSessionHistory } from "@/lib/openInterestHistory";
import { normalizeOpenInterestSeries } from "@/lib/openInterestChart";
import type { OpenInterestSnapshot } from "@/lib/market";

const GRID = "#1e222d";
const BORDER = "#2a2e3e";
const TEXT = "#787b86";
const CALL = "#ef5350";
const PUT = "#26a69a";

interface OpenInterestTimeSeriesChartProps {
  points: OpenInterestSnapshot[];
  scheduledTracking: boolean;
}

function seriesData(points: OpenInterestSnapshot[], key: keyof OpenInterestSnapshot) {
  return normalizeOpenInterestSeries(points, key).map((point) => ({
    time: point.time as Time,
    value: point.value,
  }));
}

/**
 * lightweight-charts throws when a visible range is applied before the target
 * chart has received its first data point (and can also throw while a chart is
 * being removed). Range synchronisation is best-effort in those transitions;
 * never let it take down the whole open-interest workspace.
 */
function setVisibleRangeSafely(chart: IChartApi, range: Range<Time>): boolean {
  try {
    chart.timeScale().setVisibleRange(range);
    return true;
  } catch {
    return false;
  }
}

export function OpenInterestTimeSeriesChart({ points, scheduledTracking }: OpenInterestTimeSeriesChartProps) {
  const totalsContainer = useRef<HTMLDivElement>(null);
  const changesContainer = useRef<HTMLDivElement>(null);
  const totalsChart = useRef<IChartApi | null>(null);
  const changesChart = useRef<IChartApi | null>(null);
  const totalLines = useRef<ISeriesApi<"Line">[]>([]);
  const changeLines = useRef<ISeriesApi<"Line">[]>([]);
  const hasPoints = points.length > 0;
  const fullSession = useMemo(() => hasFullSessionHistory(points), [points]);

  const resetChartView = useCallback(() => {
    totalsChart.current?.timeScale().fitContent();
    changesChart.current?.timeScale().fitContent();
  }, []);
  const zoomCharts = useCallback((direction: "in" | "out") => {
    zoomLightweightChart(totalsChart.current, direction);
    zoomLightweightChart(changesChart.current, direction);
  }, []);

  // The chart panels are conditional on having at least one snapshot. Re-run
  // initialization when the first history response arrives; an empty-state
  // render has no containers for lightweight-charts to attach to.
  useEffect(() => {
    if (!totalsContainer.current || !changesContainer.current) return;
    const options = {
      // Let lightweight-charts follow the panel width. The prior fixed-width
      // setup could create a 1px canvas during the initial flex layout and
      // never recover even when the accompanying data table had rows.
      height: 260,
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: BORDER },
      timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false, tickMarkFormatter: formatMarketTick },
      localization: MARKET_CHART_LOCALIZATION,
      crosshair: { mode: 1 as const },
    };
    const total = createChart(totalsContainer.current, options);
    const change = createChart(changesContainer.current, options);
    totalsChart.current = total;
    changesChart.current = change;
    let disposed = false;
    const resize = () => {
      if (disposed) return;
      const totalWidth = totalsContainer.current?.clientWidth ?? 0;
      const totalHeight = totalsContainer.current?.clientHeight ?? 0;
      const changeWidth = changesContainer.current?.clientWidth ?? 0;
      const changeHeight = changesContainer.current?.clientHeight ?? 0;
      if (totalWidth > 0 && totalHeight > 0) total.resize(totalWidth, totalHeight);
      if (changeWidth > 0 && changeHeight > 0) change.resize(changeWidth, changeHeight);
    };
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(totalsContainer.current);
    resizeObserver?.observe(changesContainer.current);
    const resizeFrame = window.requestAnimationFrame(resize);
    let applyingRange = false;
    const sync = (target: IChartApi) => (range: Range<Time> | null) => {
      if (disposed || applyingRange || !range) return;
      applyingRange = true;
      const applied = setVisibleRangeSafely(target, range);
      // A source chart can emit its first fit-content range before the other
      // chart has received data. Retry once on the next task; if it is still
      // empty, the points effect will establish the range after setData().
      if (!applied) {
        window.setTimeout(() => {
          if (!disposed) setVisibleRangeSafely(target, range);
        }, 0);
      }
      queueMicrotask(() => { applyingRange = false; });
    };
    const syncTotals = sync(change);
    const syncChanges = sync(total);
    total.timeScale().subscribeVisibleTimeRangeChange(syncTotals);
    change.timeScale().subscribeVisibleTimeRangeChange(syncChanges);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      total.timeScale().unsubscribeVisibleTimeRangeChange(syncTotals);
      change.timeScale().unsubscribeVisibleTimeRangeChange(syncChanges);
      total.remove();
      change.remove();
      totalsChart.current = null;
      changesChart.current = null;
      totalLines.current = [];
      changeLines.current = [];
    };
  }, [hasPoints]);

  useEffect(() => {
    const total = totalsChart.current;
    const change = changesChart.current;
    if (!total || !change) return;
    const totalRange = total.timeScale().getVisibleRange();
    totalLines.current.forEach((line) => total.removeSeries(line));
    changeLines.current.forEach((line) => change.removeSeries(line));
    const callOi = total.addLineSeries({ color: CALL, lineWidth: 2, title: "Call OI", lastValueVisible: true, pointMarkersVisible: true });
    const putOi = total.addLineSeries({ color: PUT, lineWidth: 2, title: "Put OI", lastValueVisible: true, pointMarkersVisible: true });
    const callChange = change.addLineSeries({ color: CALL, lineWidth: 2, title: "Call OI change", lastValueVisible: true, pointMarkersVisible: true });
    const putChange = change.addLineSeries({ color: PUT, lineWidth: 2, title: "Put OI change", lastValueVisible: true, pointMarkersVisible: true });
    callOi.setData(seriesData(points, "total_call_oi"));
    putOi.setData(seriesData(points, "total_put_oi"));
    callChange.setData(seriesData(points, "total_call_change"));
    putChange.setData(seriesData(points, "total_put_change"));
    totalLines.current = [callOi, putOi];
    changeLines.current = [callChange, putChange];
    // setData can run before flex/grid finishes sizing the chart panels. A
    // frame later, both the canvas dimensions and its time range are stable.
    const fitFrame = window.requestAnimationFrame(() => {
      if (totalsChart.current !== total || changesChart.current !== change) return;
      if (totalRange) {
        setVisibleRangeSafely(total, totalRange);
        setVisibleRangeSafely(change, totalRange);
      } else {
        total.timeScale().fitContent();
        change.timeScale().fitContent();
      }
    });
    return () => window.cancelAnimationFrame(fitFrame);
  }, [points]);

  if (points.length === 0) {
    return <section className="panel"><EmptyState title="Live OI history will appear after the first option-chain snapshot." /></section>;
  }

  return (
    <section className="panel flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-sm font-bold text-[var(--color-text-bright)]">Live Call vs Put OI</h2>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          The top chart is aggregate expiry OI. The lower chart shows each side&apos;s broker-reported change versus prior close, the available approximation of change since market open.
        </p>
      </div>
      {!scheduledTracking && !fullSession && (
        <p className="rounded-md border border-[var(--color-accent-orange)]/30 bg-[var(--color-accent-orange)]/5 p-2 text-xs text-[var(--color-text-secondary)]">
          History for this expiry starts from its first observation. Nearest expiries for configured underlyings are collected from market open.
        </p>
      )}
      <TimePanel title="Total Open Interest" ariaLabel="Live line chart of total Call and Put open interest over time" container={totalsContainer} onReset={resetChartView} onZoom={zoomCharts} />
      <TimePanel title="Session OI Change" ariaLabel="Live line chart of Call and Put session open-interest change over time" container={changesContainer} onReset={resetChartView} onZoom={zoomCharts} />
      <ChartDataTable
        title="live call versus put open interest"
        summary={`${points.length} timestamped aggregate observations. Session change uses the broker's prior-close baseline.`}
        columns={[
          { key: "time", label: "IST time" }, { key: "callOi", label: "Call OI" }, { key: "putOi", label: "Put OI" },
          { key: "callChange", label: "Call change" }, { key: "putChange", label: "Put change" },
        ]}
        rows={points.map((point) => ({
          time: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(point.timestamp)),
          callOi: point.total_call_oi.toLocaleString("en-IN"), putOi: point.total_put_oi.toLocaleString("en-IN"),
          callChange: point.total_call_change.toLocaleString("en-IN"), putChange: point.total_put_change.toLocaleString("en-IN"),
        }))}
      />
    </section>
  );
}

function TimePanel({ title, ariaLabel, container, onReset, onZoom }: { title: string; ariaLabel: string; container: RefObject<HTMLDivElement | null>; onReset: () => void; onZoom: (direction: "in" | "out") => void }) {
  return <div className="min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold text-[var(--color-text-bright)]">{title}</h3><ChartZoomControls label={title} onZoomIn={() => onZoom("in")} onZoomOut={() => onZoom("out")} onReset={onReset} /></div><div ref={container} role="img" aria-label={ariaLabel} title="Right-click to reset both OI charts" onContextMenu={(event) => { event.preventDefault(); onReset(); }} className="mt-3 h-[260px] w-full" /></div>;
}
