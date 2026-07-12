"use client";

/**
 * Dashboard Page — Main authenticated view.
 *
 * Displays a live welcome panel with connection info, real-time indices,
 * active alerts tracking, and an interactive module grid directing to core analytical pages.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useAlertStore } from "@/stores/alertStore";
import { useMarketData } from "@/hooks/useMarketData";
import { formatDate, formatINR } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  Gauge,
  LineChart,
  TrendingUp,
  Waves,
  Zap,
  PlayCircle,
  ArrowUpRight,
  ArrowDownRight,
  BellRing,
  Workflow
} from "lucide-react";

/** Interactive Module Directory Card */
function ModuleCard({
  icon: Icon,
  title,
  description,
  metric,
  route,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  metric?: string;
  route: string;
  color: string;
}) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(route)}
      className="glass group cursor-pointer rounded-xl p-5 transition-all duration-300 hover:scale-[1.02] hover:border-[var(--color-border-accent)] hover:shadow-2xl"
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl transition-colors duration-300 group-hover:scale-110"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="h-6 w-6" style={{ color }} />
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-text-muted)] group-hover:text-[var(--color-text-bright)] transition-colors">
          Launch <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </div>
      
      <div className="mt-4">
        <h3 className="text-base font-bold text-[var(--color-text-bright)]">
          {title}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">
          {description}
        </p>
      </div>

      {metric && (
        <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border-default)] pt-3 text-[11px]">
          <span className="text-[var(--color-text-muted)] font-medium">Status / Active Info:</span>
          <span className="font-semibold" style={{ color }}>
            {metric}
          </span>
        </div>
      )}
    </div>
  );
}

/** Ticker Card showing real-time price info */
function IndexTickerCard({
  label,
  price,
  change,
  changePercent,
  loading,
}: {
  label: string;
  price: string;
  change: number;
  changePercent: number;
  loading: boolean;
}) {
  const isUp = change >= 0;
  return (
    <div className="glass rounded-xl p-4 transition-all duration-200 hover:shadow-md">
      <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-[var(--color-bg-surface-hover)]" />
      ) : (
        <div className="mt-2 flex items-baseline justify-between">
          <p className="text-2xl font-black tracking-tight text-[var(--color-text-bright)]">
            ₹{price}
          </p>
          <div
            className={`flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full ${
              isUp 
                ? "bg-green-500/10 text-green-400" 
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            <span>
              {isUp ? "+" : ""}
              {changePercent.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, tradingMode } = useAuth();
  const alerts = useAlertStore((state) => state.alerts);
  const activeAlertsCount = alerts.filter((a) => a.status === "Active").length;
  const triggeredAlertsCount = alerts.filter((a) => a.status === "Triggered").length;

  const { getTick } = useMarketData(["NIFTY", "BANKNIFTY"]);
  
  const niftyTick = getTick("NIFTY");
  const bankNiftyTick = getTick("BANKNIFTY");

  const formatPrice = (val: number) => {
    return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 animate-fade-in pb-12">
        {/* Welcome Banner */}
        <div className="gradient-border rounded-xl shadow-xl">
          <div className="glass-strong rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-[var(--color-text-bright)] tracking-tight">
                    Welcome back, {user?.client_id || "Trader"}
                  </h2>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    tradingMode === "paper" 
                      ? "bg-amber-500/15 text-amber-400" 
                      : "bg-blue-500/15 text-blue-400"
                  }`}>
                    {tradingMode === "paper" ? "📝 Paper Mode" : "⚡ Live Market"}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
                  Connected to <span className="font-bold text-[var(--color-text-primary)]">{user?.broker_name || "Mock Broker"}</span>
                </p>
                {user?.connected_at && (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Active Session: <span className="font-mono">{formatDate(user.connected_at)}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface)] px-3 py-1.5 border border-[var(--color-border-default)]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                    Live Feed Active
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Real-time Tickers & Quick Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IndexTickerCard
            label="NIFTY 50"
            price={niftyTick ? formatPrice(niftyTick.last_price) : "—"}
            change={niftyTick ? niftyTick.change : 0}
            changePercent={niftyTick ? niftyTick.change_percent : 0}
            loading={!niftyTick}
          />
          <IndexTickerCard
            label="BANKNIFTY"
            price={bankNiftyTick ? formatPrice(bankNiftyTick.last_price) : "—"}
            change={bankNiftyTick ? bankNiftyTick.change : 0}
            changePercent={bankNiftyTick ? bankNiftyTick.change_percent : 0}
            loading={!bankNiftyTick}
          />

          <div className="glass rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                Active Alerts
              </p>
              <p className="mt-2 text-2xl font-black text-[var(--color-text-bright)]">
                {activeAlertsCount}
              </p>
            </div>
            <div className="rounded-xl bg-orange-500/10 p-2 border border-orange-500/20">
              <BellRing className="h-6 w-6 text-orange-400" />
            </div>
          </div>

          <div className="glass rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                Triggered Today
              </p>
              <p className="mt-2 text-2xl font-black text-[var(--color-text-bright)]">
                {triggeredAlertsCount}
              </p>
            </div>
            <div className="rounded-xl bg-red-500/10 p-2 border border-red-500/20">
              <Zap className="h-6 w-6 text-red-400" />
            </div>
          </div>
        </div>

        {/* Interactive Analytics Tools */}
        <div>
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)] border-b border-[var(--color-border-default)] pb-2">
            Option Analytics Cockpit
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ModuleCard
              icon={CandlestickChart}
              title="Live Option Chain"
              description="Monitor dynamic Call/Put option contracts, open interest, volumes, and bid-ask spreads in real-time."
              metric="WebSocket Streaming"
              route="/chain"
              color="var(--color-accent-green)"
            />
            <ModuleCard
              icon={TrendingUp}
              title="Payoff Strategy Builder"
              description="Analyze risk-reward payoffs for multi-leg strategies at expiry and T+0 curves with aggregated net Greeks."
              metric="Greeks Simulation"
              route="/strategy"
              color="var(--color-accent-blue)"
            />
            <ModuleCard
              icon={BarChart3}
              title="Dealer Flow GEX"
              description="Compute Gamma Exposure, locates primary Call/Put walls, and trace Zero Gamma crossovers."
              metric="Market Maker Analysis"
              route="/dealer-flow"
              color="var(--color-accent-cyan)"
            />
            <ModuleCard
              icon={Waves}
              title="Volatility Surface"
              description="Plot IV Smile, analyze Volatility Term Structure, and review IV Rank vs historical indices."
              metric="IV Smile Plotting"
              route="/volatility"
              color="var(--color-accent-purple)"
            />
            <ModuleCard
              icon={LineChart}
              title="Advanced Indicator Charts"
              description="Interactive TradingView-style charts layered with SMA, EMA, RSI, and Bollinger Bands."
              metric="lightweight-charts Core"
              route="/charts"
              color="var(--color-accent-yellow)"
            />
            <ModuleCard
              icon={PlayCircle}
              title="Simulation Playback"
              description="Replay historical trading sessions modeled on Geometric Brownian Motion (GBM) with dynamic speed controls."
              metric="Replay Engine Active"
              route="/replay"
              color="var(--color-accent-orange)"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
