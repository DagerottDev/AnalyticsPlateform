"use client";

import { useEffect, useMemo, useState } from "react";

const MAX_ZOOM_LEVEL = 6;
const ZOOM_FACTOR = 1.6;

/** Narrows a categorical Recharts dataset around its important centre point. */
export function useCategoryChartZoom<T>(data: T[], centerIndex?: number) {
  const [zoomLevel, setZoomLevel] = useState(0);
  useEffect(() => { setZoomLevel(0); }, [data]);

  const visibleData = useMemo(() => {
    if (zoomLevel === 0 || data.length < 3) return data;
    const count = Math.max(2, Math.ceil(data.length / ZOOM_FACTOR ** zoomLevel));
    const center = Math.max(0, Math.min(data.length - 1, centerIndex ?? Math.floor((data.length - 1) / 2)));
    const start = Math.max(0, Math.min(data.length - count, Math.round(center - count / 2)));
    return data.slice(start, start + count);
  }, [centerIndex, data, zoomLevel]);

  return {
    visibleData,
    canZoomIn: zoomLevel < MAX_ZOOM_LEVEL && visibleData.length > 2,
    canZoomOut: zoomLevel > 0,
    zoomIn: () => setZoomLevel((level) => Math.min(MAX_ZOOM_LEVEL, level + 1)),
    zoomOut: () => setZoomLevel((level) => Math.max(0, level - 1)),
    resetZoom: () => setZoomLevel(0),
  };
}
