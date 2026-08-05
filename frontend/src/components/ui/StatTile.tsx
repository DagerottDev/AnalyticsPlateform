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
    <Card className={cn("flex items-center justify-between", className)}>
      <div>
        <div className="flex items-center gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            {label}
          </p>
          {education}
        </div>
        <p className={cn("tnum mt-2 text-2xl font-black", toneClasses[tone])}>{value}</p>
      </div>
      {Icon && (
        <div className="rounded-xl bg-[var(--color-bg-hover)] p-2">
          <Icon className="h-6 w-6 text-[var(--color-text-secondary)]" />
        </div>
      )}
    </Card>
  );
}
