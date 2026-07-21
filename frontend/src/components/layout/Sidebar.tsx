"use client";

/**
 * Sidebar — Navigation sidebar for the dashboard.
 *
 * TradingView-style collapsible sidebar with icon-based navigation
 * and grouped menu sections.
 */

import { cn } from "@/lib/utils";
import {
  BarChart3,
  Blocks,
  Boxes,
  Briefcase,
  CandlestickChart,
  CircleUserRound,
  History,
  LayoutDashboard,
  LineChart,
  Settings,
  Waves,
  Zap,
} from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  disabled?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
      { icon: CircleUserRound, label: "Accounts", href: "/accounts" },
      { icon: CandlestickChart, label: "Option Chain", href: "/chain" },
    ],
  },
  {
    title: "Analytics",
    items: [
      { icon: LineChart, label: "Charts", href: "/charts" },
      { icon: Waves, label: "Volatility", href: "/volatility" },
      { icon: BarChart3, label: "Dealer Flow", href: "/dealer-flow" },
    ],
  },
  {
    title: "Trading",
    items: [
      { icon: Zap, label: "Alerts", href: "/alerts" },
      { icon: Briefcase, label: "Positions", href: "/positions", disabled: true },
      { icon: History, label: "Replay Mode", href: "/replay" },
      { icon: Blocks, label: "Strategy Builder", href: "/strategy" },
    ],
  },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] transition-all duration-300",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-10 items-center justify-center border-b border-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Boxes className="h-4 w-4" />
      </button>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto p-2">
        {navigation.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && (
              <h3 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                {group.title}
              </h3>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <li key={item.href}>
                    <button
                      onClick={() => !item.disabled && router.push(item.href)}
                      disabled={item.disabled}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                        isActive
                          ? "bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
                          : item.disabled
                            ? "cursor-not-allowed text-[var(--color-text-muted)]/50"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
                        collapsed && "justify-center px-0"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive && "text-[var(--color-accent-blue)]"
                        )}
                      />
                      {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom — Settings */}
      <div className="border-t border-[var(--color-border-subtle)] p-2">
        <button
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
            collapsed && "justify-center px-0"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
}
