"use client";

import { cn } from "@/lib/utils";

interface OiStrengthBarProps {
  /** OI for this strike/side, or null/undefined when there's no contract. */
  oi: number | null | undefined;
  /** Largest OI across the visible chain — bar length is `oi / maxOi`. */
  maxOi: number;
  /** Snapshot-to-snapshot OI change; sign drives the bar's colour. */
  change: number | null;
  className?: string;
}

/** A hairline data-bar rendered under an OI figure: length signals how big
 * this strike's open interest is relative to the rest of the visible chain
 * (its "strength"), colour signals whether OI is building (green) or
 * unwinding (red) since the last snapshot. Purely decorative — the numeric
 * cell next to/above it remains the source of truth. */
export function OiStrengthBar({ oi, maxOi, change, className }: OiStrengthBarProps) {
  if (oi == null || maxOi <= 0) return null;

  const pct = Math.max(4, Math.min(100, (oi / maxOi) * 100));
  const color = change && change > 0
    ? "var(--color-vibrant-up)"
    : change && change < 0
      ? "var(--color-vibrant-down)"
      : "var(--color-vibrant-neutral)";

  return (
    <div
      className={cn("h-[4px] w-full overflow-hidden rounded-full bg-[var(--color-border-subtle)]", className)}
      role="img"
      aria-label={`Open interest ${oi.toLocaleString()}, ${Math.round(pct)}% of the largest OI in view${change ? `, ${change > 0 ? "up" : "down"} since last snapshot` : ""}`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px 0 ${color}` }}
      />
    </div>
  );
}
