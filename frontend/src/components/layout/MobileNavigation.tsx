"use client";

import { cn } from "@/lib/utils";
import {
  ArrowUpDown,
  BarChart3,
  Blocks,
  Briefcase,
  CandlestickChart,
  CircleUserRound,
  History,
  LayoutDashboard,
  Menu,
  PlayCircle,
  Settings,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const primaryItems = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Chain", href: "/chain", icon: CandlestickChart },
  { label: "Alerts", href: "/alerts", icon: Zap },
];

const allItems = [
  ...primaryItems,
  { label: "Accounts", href: "/accounts", icon: CircleUserRound },
  { label: "Charts", href: "/charts", icon: BarChart3 },
  { label: "Open Interest", href: "/open-interest", icon: BarChart3 },
  { label: "Volatility", href: "/volatility", icon: Waves },
  { label: "Relative Value", href: "/relative-value", icon: BarChart3 },
  { label: "Dealer Flow", href: "/dealer-flow", icon: BarChart3 },
  { label: "Orders", href: "/orders", icon: ArrowUpDown },
  { label: "Trade Journal", href: "/journal", icon: History },
  { label: "Positions", href: "/positions", icon: Briefcase },
  { label: "Replay", href: "/replay", icon: PlayCircle },
  { label: "Strategy Builder", href: "/strategy", icon: Blocks },
  { label: "Settings", href: "/settings", icon: Settings },
];

/** Compact navigation for phones; the full sidebar takes over at md. */
export function MobileNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) menuRef.current?.focus();
  }, [isOpen]);

  const navigate = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  const closeMenu = () => {
    setIsOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <>
      {isOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          onClick={closeMenu}
        />
      )}

      <nav className="glass-strong fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-border-default)] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => navigate(item.href)}
                className={cn(
                  "focus-ring flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold",
                  active ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-muted)]"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
          <button
            ref={menuButtonRef}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setIsOpen((value) => !value)}
            className={cn(
              "focus-ring flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold",
              isOpen ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-muted)]"
            )}
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            More
          </button>
        </div>
      </nav>

      {isOpen && (
        <section
          ref={menuRef}
          tabIndex={-1}
          aria-label="All navigation"
          onKeyDown={(event) => { if (event.key === "Escape") closeMenu(); }}
          className="glass-strong fixed inset-x-3 bottom-20 z-50 max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border border-[var(--color-border-default)] p-3 shadow-[var(--shadow-elevation-3)] focus:outline-none md:hidden"
        >
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Navigate
          </p>
          <div className="grid grid-cols-2 gap-1">
            {allItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <button
                  key={item.href}
                  onClick={() => navigate(item.href)}
                  className={cn(
                    "focus-ring flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium",
                    active
                      ? "bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
