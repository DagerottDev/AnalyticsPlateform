import { cn } from "@/lib/utils";
import type { ReactNode, ElementType } from "react";

interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}>
      {Icon && <Icon className="h-8 w-8 text-[var(--color-text-muted)]" />}
      <p className="text-sm font-semibold text-[var(--color-text-secondary)]">{title}</p>
      {description && <p className="max-w-sm text-xs text-[var(--color-text-muted)]">{description}</p>}
      {action}
    </div>
  );
}
