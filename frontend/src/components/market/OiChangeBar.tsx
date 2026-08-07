"use client";

import { cn } from "@/lib/utils";

interface OiChangeBarProps {
  /** Snapshot-to-snapshot (or broker-reported) OI change for this side. */
  change: number | null;
  /** Largest |change| across the visible chain — bar length is `|change| / maxAbsChange`. */
  maxAbsChange: number;
  className?: string;
}

/** A hairline data-bar for the "OI Δ" column. Deliberately the mirror image
 * of OiStrengthBar: it fills from the right edge instead of the left, and
 * uses its own vibrant hue pair (blue/pink, not green/red/cyan) so the two
 * bars read as a contrasting companion pair rather than duplicates sitting
 * side by side. Length signals the magnitude of this strike's OI change
 * relative to the rest of the visible chain; colour signals its direction. */
export function OiChangeBar({ change, maxAbsChange, className }: OiChangeBarProps) {
  if (!change || maxAbsChange <= 0) return null;

  const pct = Math.max(4, Math.min(100, (Math.abs(change) / maxAbsChange) * 100));
  const color = change > 0 ? "var(--color-vibrant-change-up)" : "var(--color-vibrant-change-down)";

  return (
    <div
      className={cn("flex h-[4px] w-full justify-end overflow-hidden rounded-full bg-[var(--color-border-subtle)]", className)}
      role="img"
      aria-label={`Open interest ${change > 0 ? "up" : "down"} ${Math.abs(change).toLocaleString()}, ${Math.round(pct)}% of the largest OI change in view`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px 0 ${color}` }}
      />
    </div>
  );
}
