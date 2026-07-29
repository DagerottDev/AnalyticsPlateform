"use client";

import { cn } from "@/lib/utils";
import { useRef, type ElementType, type KeyboardEvent } from "react";

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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;

    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    onChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b border-[var(--color-border-default)]", className)}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const isActive = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(element) => { tabRefs.current[index] = element; }}
            className={cn(
              "focus-ring relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors",
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
