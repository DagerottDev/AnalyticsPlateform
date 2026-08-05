"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { IChartApi, Range, Time } from "lightweight-charts";

type ChartTimeRange = Range<Time>;

interface GreekChartSyncContextValue {
  enabled: boolean;
  registerChart: (id: string, chart: IChartApi, applyCrosshair?: (time: Time | null) => void) => () => void;
  notifyTimeRange: (sourceId: string, range: ChartTimeRange | null) => void;
  notifyCrosshair: (sourceId: string, time: Time | null) => void;
}

const NOOP_CONTEXT: GreekChartSyncContextValue = {
  enabled: false,
  registerChart: () => () => undefined,
  notifyTimeRange: () => undefined,
  notifyCrosshair: () => undefined,
};

const GreekChartSyncContext = createContext<GreekChartSyncContextValue>(NOOP_CONTEXT);

interface GreekChartSyncProviderProps {
  enabled: boolean;
  children: ReactNode;
}

interface RegisteredChart {
  chart: IChartApi;
  applyCrosshair: (time: Time | null) => void;
}

/** Coordinate the visible time range and crosshair for every workspace chart. */
export function GreekChartSyncProvider({ enabled, children }: GreekChartSyncProviderProps) {
  const chartsRef = useRef(new Map<string, RegisteredChart>());
  const applyingRangeRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const applyRange = useCallback((range: ChartTimeRange, sourceId?: string) => {
    applyingRangeRef.current = true;
    try {
      for (const [id, registration] of chartsRef.current) {
        if (id === sourceId) continue;
        registration.chart.timeScale().setVisibleRange(range);
      }
    } finally {
      // Release the guard after scheduled chart change events have settled.
      queueMicrotask(() => { applyingRangeRef.current = false; });
    }
  }, []);

  const registerChart = useCallback((id: string, chart: IChartApi, applyCrosshair: (time: Time | null) => void = () => undefined) => {
    chartsRef.current.set(id, { chart, applyCrosshair });
    if (enabledRef.current) {
      const range = chart.timeScale().getVisibleRange();
      if (range) applyRange(range, id);
    }
    return () => {
      if (chartsRef.current.get(id)?.chart === chart) chartsRef.current.delete(id);
    };
  }, [applyRange]);

  const notifyTimeRange = useCallback((sourceId: string, range: ChartTimeRange | null) => {
    if (!enabledRef.current || applyingRangeRef.current || !range) return;
    applyRange(range, sourceId);
  }, [applyRange]);

  const notifyCrosshair = useCallback((sourceId: string, time: Time | null) => {
    if (!enabledRef.current) return;
    for (const [id, registration] of chartsRef.current) {
      if (id === sourceId) continue;
      try {
        registration.applyCrosshair(time);
      } catch {
        // A chart can be disposed during React effect replay. The chart's
        // cleanup unregisters it, but a native event may still be in flight.
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const firstChart = chartsRef.current.values().next().value as RegisteredChart | undefined;
    const range = firstChart?.chart.timeScale().getVisibleRange();
    if (range) applyRange(range);
  }, [applyRange, enabled]);

  const value = useMemo(() => ({ enabled, registerChart, notifyTimeRange, notifyCrosshair }), [enabled, notifyCrosshair, notifyTimeRange, registerChart]);
  return <GreekChartSyncContext.Provider value={value}>{children}</GreekChartSyncContext.Provider>;
}

export function useGreekChartSync(): GreekChartSyncContextValue {
  return useContext(GreekChartSyncContext);
}
