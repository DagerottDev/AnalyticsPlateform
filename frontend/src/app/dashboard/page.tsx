"use client";

/**
 * Dashboard Page — Main authenticated view.
 *
 * Displays a welcome panel with connection info and placeholder
 * panels for upcoming features (M2+ milestones).
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatINR } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  Gauge,
  LineChart,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";

/** Metric card for the overview grid */
function MetricCard({
  icon: Icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div className="glass group rounded-xl p-4 transition-all hover:border-[var(--color-border-accent)] hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            {label}
          </p>
          <p className="mt-1 text-xl font-bold text-[var(--color-text-bright)]">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
      </div>
    </div>
  );
}

/** Placeholder panel for upcoming features */
function FeaturePreviewCard({
  icon: Icon,
  title,
  milestone,
  description,
}: {
  icon: React.ElementType;
  title: string;
  milestone: string;
  description: string;
}) {
  return (
    <div className="glass group flex items-center gap-4 rounded-xl p-4 opacity-60 transition-all hover:opacity-80">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-surface)]">
        <Icon className="h-5 w-5 text-[var(--color-text-muted)]" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
            {title}
          </h3>
          <span className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
            {milestone}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, tradingMode } = useAuth();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 animate-fade-in">
        {/* Welcome Banner */}
        <div className="gradient-border rounded-xl">
          <div className="glass-strong rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-bright)]">
                  Welcome back, {user?.client_id || "Trader"}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Connected to {user?.broker_name} •{" "}
                  {tradingMode === "paper" ? "📝 Paper Trading" : "⚡ Live Trading"}
                </p>
                {user?.connected_at && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    Session started: {formatDate(user.connected_at)}
                  </p>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-cyan)] shadow-lg">
                  <Activity className="h-6 w-6 text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={Gauge}
            label="Market Status"
            value="Pre-Open"
            subtitle="NSE: 9:00 AM IST"
            color="var(--color-accent-green)"
          />
          <MetricCard
            icon={TrendingUp}
            label="NIFTY 50"
            value="—"
            subtitle="Awaiting market data (M2)"
            color="var(--color-accent-blue)"
          />
          <MetricCard
            icon={BarChart3}
            label="BANKNIFTY"
            value="—"
            subtitle="Awaiting market data (M2)"
            color="var(--color-accent-cyan)"
          />
          <MetricCard
            icon={Zap}
            label="Active Alerts"
            value="0"
            subtitle="No alerts configured (M9)"
            color="var(--color-accent-orange)"
          />
        </div>

        {/* Upcoming Features */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Coming Soon
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FeaturePreviewCard
              icon={CandlestickChart}
              title="Live Option Chain"
              milestone="M2"
              description="Real-time option chain with live WebSocket data"
            />
            <FeaturePreviewCard
              icon={TrendingUp}
              title="Greek Analytics"
              milestone="M4"
              description="First & second order Greeks with multi-strike analysis"
            />
            <FeaturePreviewCard
              icon={LineChart}
              title="Advanced Charting"
              milestone="M5"
              description="TradingView-style charts with 13+ technical indicators"
            />
            <FeaturePreviewCard
              icon={Waves}
              title="Volatility Surface"
              milestone="M6"
              description="IV Smile, IV Surface, Term Structure, IV Rank"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
