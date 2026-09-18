import { cn } from "@/lib/utils";
import { Card } from "./Card";
import type { ReactNode, ElementType } from "react";

type Tone = "neutral" | "profit" | "loss";

interface StatTileProps {
  label: string;
  value: ReactNode;
  icon?: ElementType;
  education?: ReactNode;
  tone?: Tone;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  neutral: "text-[var(--color-text-bright)]",
  profit: "text-[var(--color-profit)]",
  loss: "text-[var(--color-loss)]",
};

export function StatTile({ label, value, icon: Icon, education, tone = "neutral", className }: StatTileProps) {
  return (
    <Card className={cn("flex items-center justify-between overflow-hidden", className)}>
      <div>
        <div className="flex items-center gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            {label}
          </p>
          {education}
        </div>
        <p className={cn("tnum mt-2 font-mono text-2xl font-bold tracking-[-0.04em]", toneClasses[tone])}>{value}</p>
      </div>
      {Icon && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-2.5">
          <Icon className="h-5 w-5 text-[var(--color-text-secondary)]" />
        </div>
      )}
    </Card>
  );
}
