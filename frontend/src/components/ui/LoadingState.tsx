import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type Size = "sm" | "md" | "lg";

interface LoadingStateProps {
  label?: string;
  size?: Size;
  className?: string;
}

const sizeClasses: Record<Size, { box: string; icon: string }> = {
  sm: { box: "h-24", icon: "h-5 w-5" },
  md: { box: "h-48", icon: "h-6 w-6" },
  lg: { box: "h-96", icon: "h-8 w-8" },
};

export function LoadingState({ label = "Loading...", size = "md", className }: LoadingStateProps) {
  const s = sizeClasses[size];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", s.box, className)}>
      <Loader2 className={cn("animate-spin text-[var(--color-accent-blue)]", s.icon)} />
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
