import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** panel = flat surface (default, use everywhere). glass = hero emphasis
   * only (welcome banner, login form, connected-account card). */
  variant?: "panel" | "glass";
}

export function Card({ variant = "panel", className, children, ...props }: CardProps) {
  if (variant === "glass") {
    return (
      <div className="gradient-border rounded-xl">
        <div className={cn("glass-strong rounded-xl p-5 sm:p-6", className)} {...props}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("panel p-4 sm:p-5", className)} {...props}>
      {children}
    </div>
  );
}
