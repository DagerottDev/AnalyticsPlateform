"use client";

interface LegendItem {
  label: string;
  color: string;
}

/**
 * A small colored-dot legend row for canvas-based charts (lightweight-charts)
 * that don't render their own legend. Pass the exact same hex constants used
 * for the series so the dot always matches the line.
 */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 px-2 text-xs text-[var(--color-text-secondary)]">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}
