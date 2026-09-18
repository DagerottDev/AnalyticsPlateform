import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Tone = "neutral" | "blue" | "profit" | "loss" | "orange" | "purple";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]",
  blue: "bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]",
  profit: "bg-[var(--color-profit)]/15 text-[var(--color-profit)]",
  loss: "bg-[var(--color-loss)]/15 text-[var(--color-loss)]",
  orange: "bg-[var(--color-accent-orange)]/15 text-[var(--color-accent-orange)]",
  purple: "bg-[var(--color-accent-purple)]/15 text-[var(--color-accent-purple)]",
};

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center gap-1 rounded-full border border-current/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
