"use client";

import { cn } from "@/lib/utils";
import type { ElementType } from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: ElementType;
}

interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b border-[var(--color-border-default)]", className)}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              isActive
                ? "text-[var(--color-accent-blue)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[var(--color-accent-blue)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}
