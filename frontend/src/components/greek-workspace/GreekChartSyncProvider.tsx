"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { IChartApi, Range, Time } from "lightweight-charts";

type ChartTimeRange = Range<Time>;

interface GreekChartSyncContextValue {
  enabled: boolean;
  registerChart: (id: string, chart: IChartApi) => () => void;
  notifyTimeRange: (sourceId: string, range: ChartTimeRange | null) => void;
}

const NOOP_CONTEXT: GreekChartSyncContextValue = {
  enabled: false,
  registerChart: () => () => undefined,
  notifyTimeRange: () => undefined,
};

const GreekChartSyncContext = createContext<GreekChartSyncContextValue>(NOOP_CONTEXT);

interface GreekChartSyncProviderProps {
  enabled: boolean;
  children: ReactNode;
}

/** Coordinate the visible time range for every Greek chart in the workspace. */
export function GreekChartSyncProvider({ enabled, children }: GreekChartSyncProviderProps) {
  const chartsRef = useRef(new Map<string, IChartApi>());
  const applyingRangeRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const applyRange = useCallback((range: ChartTimeRange, sourceId?: string) => {
    applyingRangeRef.current = true;
    try {
      for (const [id, chart] of chartsRef.current) {
        if (id === sourceId) continue;
        chart.timeScale().setVisibleRange(range);
      }
    } finally {
      // Release the guard after scheduled chart change events have settled.
      queueMicrotask(() => { applyingRangeRef.current = false; });
    }
  }, []);

  const registerChart = useCallback((id: string, chart: IChartApi) => {
    chartsRef.current.set(id, chart);
    if (enabledRef.current) {
      const range = chart.timeScale().getVisibleRange();
      if (range) applyRange(range, id);
    }
    return () => {
      if (chartsRef.current.get(id) === chart) chartsRef.current.delete(id);
    };
  }, [applyRange]);

  const notifyTimeRange = useCallback((sourceId: string, range: ChartTimeRange | null) => {
    if (!enabledRef.current || applyingRangeRef.current || !range) return;
    applyRange(range, sourceId);
  }, [applyRange]);

  useEffect(() => {
    if (!enabled) return;
    const firstChart = chartsRef.current.values().next().value as IChartApi | undefined;
    const range = firstChart?.timeScale().getVisibleRange();
    if (range) applyRange(range);
  }, [applyRange, enabled]);

  const value = useMemo(() => ({ enabled, registerChart, notifyTimeRange }), [enabled, notifyTimeRange, registerChart]);
  return <GreekChartSyncContext.Provider value={value}>{children}</GreekChartSyncContext.Provider>;
}

export function useGreekChartSync(): GreekChartSyncContextValue {
  return useContext(GreekChartSyncContext);
}
