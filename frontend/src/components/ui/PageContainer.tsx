import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

/** The one page-layout wrapper — use on every app/*\/page.tsx. */
export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn("mx-auto max-w-6xl space-y-4 pb-6 animate-fade-in sm:space-y-6 sm:pb-12", className)}>
      {children}
    </div>
  );
}
