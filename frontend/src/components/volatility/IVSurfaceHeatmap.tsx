"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartDataTable } from "@/components/charts/ChartDataTable";

interface IVSurfaceHeatmapProps {
  data: {
    expiry: string;
    strike: number;
    iv: number;
  }[];
}

// Sequential ramp (single hue, light -> dark magnitude), validated with the
// dataviz skill's ordinal check against the app's dark chart surface — see
// docs/DESIGN_SYSTEM.md. Never a rainbow: one hue only for magnitude data.
const SEQUENTIAL_RAMP = ["#163c50", "#17607a", "#178aa7", "#37b7d0", "#a3e8f2"];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function interpolateRamp(ramp: string[], t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const segments = ramp.length - 1;
  const pos = clamped * segments;
  const idx = Math.min(Math.floor(pos), segments - 1);
  const localT = pos - idx;

  const [r1, g1, b1] = hexToRgb(ramp[idx]);
  const [r2, g2, b2] = hexToRgb(ramp[idx + 1]);
  const r = Math.round(r1 + (r2 - r1) * localT);
  const g = Math.round(g1 + (g2 - g1) * localT);
  const b = Math.round(b1 + (b2 - b1) * localT);
  return `rgb(${r}, ${g}, ${b})`;
}

export function IVSurfaceHeatmap({ data }: IVSurfaceHeatmapProps) {
  const { expirations, strikes, gridData, minIV, maxIV } = useMemo(() => {
    if (!data || data.length === 0) {
      return { expirations: [], strikes: [], gridData: {}, minIV: 0, maxIV: 0 };
    }

    const exps = Array.from(new Set(data.map(d => d.expiry))).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const strs = Array.from(new Set(data.map(d => d.strike))).sort((a, b) => b - a); // high to low

    let min = Infinity;
    let max = -Infinity;

    const grid: Record<string, Record<number, number>> = {};
    exps.forEach(e => {
      grid[e] = {};
      strs.forEach(s => {
        grid[e][s] = 0;
      });
    });

    data.forEach(d => {
      if (d.iv > 0) {
        grid[d.expiry][d.strike] = d.iv;
        if (d.iv < min) min = d.iv;
        if (d.iv > max) max = d.iv;
      }
    });

    if (min === Infinity) { min = 0; max = 1; }

    return { expirations: exps, strikes: strs, gridData: grid, minIV: min, maxIV: max };
  }, [data]);

  if (expirations.length === 0) {
    return (
      <div className="panel flex h-[300px] items-center justify-center">
        <EmptyState title="No data available for IV Surface." />
      </div>
    );
  }

  // Map IV to the sequential ramp; missing data gets a neutral placeholder.
  const getRatio = (iv: number) => (maxIV > minIV ? (iv - minIV) / (maxIV - minIV) : 0.5);
  const getColor = (iv: number) => {
    if (iv === 0) return "var(--color-bg-hover)";
    return interpolateRamp(SEQUENTIAL_RAMP, getRatio(iv));
  };
  // The top of the ramp is light enough that white text loses contrast.
  const getTextColor = (iv: number) => (iv > 0 && getRatio(iv) > 0.6 ? "var(--color-bg-primary)" : "rgba(255, 255, 255, 0.9)");

  return (
    <div className="panel flex flex-col gap-2 overflow-x-auto">
      <h3 className="mb-2 text-sm font-bold text-[var(--color-text-bright)]">IV Surface (Strike vs Expiry)</h3>

      <div role="img" aria-label={`Implied-volatility surface across ${strikes.length} strikes and ${expirations.length} expiries. Exact values are available in the following data table.`} className="flex w-max min-w-full">
        {/* Y-Axis: Strikes */}
        <div className="flex flex-col justify-end pt-[28px]">
          {strikes.map(strike => (
            <div key={strike} className="tnum flex h-6 w-16 items-center pr-2 text-right text-xs font-mono text-[var(--color-text-secondary)]">
              {strike}
            </div>
          ))}
        </div>

        {/* Grid Data */}
        <div className="flex flex-1 flex-col">
          {/* X-Axis: Expirations */}
          <div className="flex h-[28px]">
            {expirations.map(exp => (
              <div key={exp} className="flex w-16 flex-1 items-center justify-center truncate px-1 text-[10px] font-mono text-[var(--color-text-secondary)]">
                {exp}
              </div>
            ))}
          </div>

          {/* Matrix Rows */}
          {strikes.map(strike => (
            <div key={strike} className="flex h-6">
              {expirations.map(exp => {
                const iv = gridData[exp][strike];
                return (
                  <div
                    key={`${exp}-${strike}`}
                    className="tnum m-[1px] flex w-16 flex-1 cursor-pointer items-center justify-center rounded-[2px] font-mono text-[9px] transition-transform hover:scale-110"
                    style={{ backgroundColor: getColor(iv), color: getTextColor(iv) }}
                    title={`Expiry: ${exp}\nStrike: ${strike}\nIV: ${(iv * 100).toFixed(1)}%`}
                  >
                    {iv > 0 ? (iv * 100).toFixed(0) : "-"}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ChartDataTable
        title="implied volatility surface"
        summary={`${data.length} strike and expiry combinations. Implied volatility is shown as a percentage.`}
        columns={[{ key: "expiry", label: "Expiry" }, { key: "strike", label: "Strike" }, { key: "iv", label: "Implied volatility" }]}
        rows={data.filter((point) => point.iv > 0).map((point) => ({ expiry: point.expiry, strike: point.strike.toLocaleString(), iv: `${(point.iv * 100).toFixed(2)}%` }))}
      />

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-[var(--color-text-muted)]">
        <span>Low IV ({(minIV * 100).toFixed(1)}%)</span>
        <div
          className="h-2 w-32 rounded-full"
          style={{ background: `linear-gradient(to right, ${SEQUENTIAL_RAMP.join(", ")})` }}
        />
        <span>High IV ({(maxIV * 100).toFixed(1)}%)</span>
      </div>
    </div>
  );
}
