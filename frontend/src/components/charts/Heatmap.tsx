"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartDataTable } from "./ChartDataTable";

interface HeatmapProps {
  data: { strike: number; ceValue: number; peValue: number }[];
  maxValue?: number;
  title?: string;
  type?: "volume" | "oi";
}

export function Heatmap({ data, maxValue, title }: HeatmapProps) {
  const maxVal = useMemo(() => {
    if (maxValue) return maxValue;
    return Math.max(...data.map(d => Math.max(d.ceValue, d.peValue)), 1); // Avoid div by 0
  }, [data, maxValue]);

  if (!data || data.length === 0) {
    return (
      <div className="panel">
        <EmptyState title="No data available for heatmap" />
      </div>
    );
  }

  return (
    <div className="panel flex w-full flex-col gap-2">
      {title && <h3 className="text-sm font-bold text-[var(--color-text-bright)]">{title}</h3>}

      <div className="flex items-end justify-between border-b border-[var(--color-border-default)] pb-2 text-xs font-semibold text-[var(--color-text-muted)]">
        <div className="w-[40%] text-right text-[var(--color-profit)]">Calls (CE)</div>
        <div className="w-[20%] text-center">Strike</div>
        <div className="w-[40%] text-left text-[var(--color-loss)]">Puts (PE)</div>
      </div>

      <div className="flex flex-col gap-1 py-2">
        {data.map((row) => {
          const cePct = Math.min((row.ceValue / maxVal) * 100, 100);
          const pePct = Math.min((row.peValue / maxVal) * 100, 100);

          return (
            <div key={row.strike} className="tnum flex h-6 items-center justify-between text-xs font-mono">
              {/* CE Bar */}
              <div className="flex h-full w-[40%] items-center justify-end overflow-hidden pr-2">
                <span className="mr-2 hidden text-[10px] text-[var(--color-text-muted)] sm:inline-block">
                  {row.ceValue.toLocaleString()}
                </span>
                <div
                  className="h-full rounded-l-sm bg-[var(--color-profit)]/30 transition-all duration-300"
                  style={{ width: `${cePct}%` }}
                />
              </div>

              {/* Strike */}
              <div className="flex w-[20%] items-center justify-center font-bold text-[var(--color-text-secondary)]">
                {row.strike}
              </div>

              {/* PE Bar */}
              <div className="flex h-full w-[40%] items-center justify-start overflow-hidden pl-2">
                <div
                  className="h-full rounded-r-sm bg-[var(--color-loss)]/30 transition-all duration-300"
                  style={{ width: `${pePct}%` }}
                />
                <span className="ml-2 hidden text-[10px] text-[var(--color-text-muted)] sm:inline-block">
                  {row.peValue.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <ChartDataTable
        title={title ?? "options heatmap"}
        summary={`${data.length} strikes with call and put values. Bar length represents the value relative to the largest value in this heatmap.`}
        columns={[{ key: "strike", label: "Strike" }, { key: "ceValue", label: "Call value" }, { key: "peValue", label: "Put value" }]}
        rows={data.map((row) => ({ strike: row.strike.toLocaleString(), ceValue: row.ceValue.toLocaleString(), peValue: row.peValue.toLocaleString() }))}
      />
    </div>
  );
}
