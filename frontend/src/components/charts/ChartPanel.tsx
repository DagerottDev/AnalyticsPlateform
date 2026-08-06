"use client";

import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartDataTable, type ChartCell } from "@/components/charts/ChartDataTable";
import { ChartZoomControls } from "@/components/charts/ChartZoomControls";

interface ChartPanelProps {
  /** When true, renders the empty state instead of the chart. */
  isEmpty: boolean;
  emptyTitle: string;
  /** Tailwind height class shared by the empty state and the chart's aria-labelled wrapper, e.g. "h-[300px]". */
  height: string;
  title: ReactNode;
  /** Label passed to ChartZoomControls, e.g. "gamma exposure profile". */
  zoomLabel: string;
  ariaLabel: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  tableTitle: string;
  tableSummary: string;
  tableColumns: { key: string; label: string }[];
  tableRows: Record<string, ChartCell>[];
  /** The recharts chart element (e.g. <BarChart>...</BarChart>) to render inside ResponsiveContainer. */
  children: ReactElement;
}

/**
 * Shared scaffold for the recharts-based category charts (empty state,
 * title + zoom controls header, an accessible role="img" wrapper around
 * ResponsiveContainer, and the ChartDataTable footer). Extracted from four
 * near-identical implementations across the dealer-flow and volatility
 * chart families — each caller supplies only its axes/series/reference
 * lines as `children`.
 */
export function ChartPanel({
  isEmpty, emptyTitle, height, title, zoomLabel, ariaLabel, onZoomIn, onZoomOut, onZoomReset,
  tableTitle, tableSummary, tableColumns, tableRows, children,
}: ChartPanelProps) {
  if (isEmpty) {
    return (
      <div className={cn("panel flex items-center justify-center", height)}>
        <EmptyState title={emptyTitle} />
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-bold text-[var(--color-text-bright)]">{title}</h3>
        <ChartZoomControls label={zoomLabel} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onZoomReset} />
      </div>
      <div role="img" aria-label={ariaLabel} className={cn("w-full", height)}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <ChartDataTable title={tableTitle} summary={tableSummary} columns={tableColumns} rows={tableRows} />
    </div>
  );
}
