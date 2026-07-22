import { Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradingMode } from "@/types/auth";

interface TradingModeToggleProps {
  value: TradingMode;
  onChange: (mode: TradingMode) => void;
  size?: "sm" | "md";
}

/** Shared Paper/Live segmented control — used by both LoginForm and AccountsPage. */
export function TradingModeToggle({ value, onChange, size = "md" }: TradingModeToggleProps) {
  const isPaper = value === "paper";
  const padding = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm";
  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]",
        size === "sm" ? "p-0.5" : "p-1"
      )}
    >
      <button
        type="button"
        onClick={() => onChange("paper")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md font-bold transition-all",
          padding,
          isPaper
            ? "bg-[var(--color-accent-blue)] text-white shadow-sm"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-bright)]"
        )}
      >
        <Shield className={iconSize} />
        Paper
      </button>
      <button
        type="button"
        onClick={() => onChange("live")}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md font-bold transition-all",
          padding,
          !isPaper
            ? "bg-[var(--color-accent-red)] text-white shadow-sm"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-bright)]"
        )}
      >
        <Zap className={iconSize} />
        Live
      </button>
    </div>
  );
}
