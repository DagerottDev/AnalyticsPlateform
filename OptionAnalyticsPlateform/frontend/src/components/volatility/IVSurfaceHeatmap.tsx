"use client";

import { useMemo } from "react";

interface IVSurfaceHeatmapProps {
  data: {
    expiry: string;
    strike: number;
    iv: number;
  }[];
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
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)]">
        No data available for IV Surface.
      </div>
    );
  }

  // Helper to map IV to a color gradient (Cold Blue to Hot Red)
  const getColor = (iv: number) => {
    if (iv === 0) return "rgba(39, 39, 42, 0.5)"; // bg-zinc-800 missing data
    
    // Normalize between 0 and 1
    const ratio = maxIV > minIV ? (iv - minIV) / (maxIV - minIV) : 0.5;
    
    // HSL: Blue (240) to Red (0)
    const hue = (1 - ratio) * 240; 
    return `hsl(${hue}, 80%, 50%)`;
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-xl overflow-x-auto">
      <h3 className="text-sm font-bold text-[var(--color-text-bright)] mb-2">IV Surface (Strike vs Expiry)</h3>
      
      <div className="flex w-max min-w-full">
        {/* Y-Axis: Strikes */}
        <div className="flex flex-col justify-end pt-[28px]">
          {strikes.map(strike => (
            <div key={strike} className="h-6 flex items-center pr-2 text-xs font-mono text-[var(--color-text-secondary)] text-right w-16">
              {strike}
            </div>
          ))}
        </div>
        
        {/* Grid Data */}
        <div className="flex flex-col flex-1">
          {/* X-Axis: Expirations */}
          <div className="flex h-[28px]">
            {expirations.map(exp => (
              <div key={exp} className="flex-1 flex items-center justify-center text-[10px] font-mono text-[var(--color-text-secondary)] px-1 truncate w-16">
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
                    className="flex-1 m-[1px] rounded-[2px] flex items-center justify-center text-[9px] text-white/90 font-mono transition-transform hover:scale-110 cursor-pointer w-16"
                    style={{ backgroundColor: getColor(iv) }}
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

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-[var(--color-text-muted)]">
        <span>Low IV ({(minIV * 100).toFixed(1)}%)</span>
        <div className="w-32 h-2 rounded-full bg-gradient-to-r from-blue-500 via-green-500 to-red-500"></div>
        <span>High IV ({(maxIV * 100).toFixed(1)}%)</span>
      </div>
    </div>
  );
}
