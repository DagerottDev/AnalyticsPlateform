"use client";

/**
 * Dashboard Page — Main authenticated view.
 *
 * Displays a live welcome panel with connection info, real-time indices,
 * active alerts tracking, and an interactive module grid directing to core analytical pages.
 */

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useAlertStore } from "@/stores/alertStore";
import { useTickerStore } from "@/stores/tickerStore";
import { useMarketData } from "@/hooks/useMarketData";
import { formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatTile } from "@/components/ui/StatTile";
import { PageContainer } from "@/components/ui/PageContainer";
import { Eyebrow } from "@/components/ui/SectionHeader";
import { AddTickerModal } from "@/components/market/AddTickerModal";
import {
  BarChart3,
  CandlestickChart,
  LineChart,
  TrendingUp,
  Waves,
  Zap,
  PlayCircle,
  ArrowUpRight,
  ArrowDownRight,
  BellRing,
  Plus,
  X,
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
    <Card
      onClick={() => router.push(route)}
      className="group cursor-pointer p-5 transition-all duration-300 hover:border-[var(--color-border-accent)] hover:shadow-[var(--shadow-elevation-2)]"
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
        <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-3 text-[11px]">
          <span className="font-medium text-[var(--color-text-muted)]">Status / Active Info:</span>
          <span className="font-semibold" style={{ color }}>
            {metric}
          </span>
        </div>
      )}
    </Card>
  );
}

/** Ticker Card showing real-time price info */
function IndexTickerCard({
  symbol,
  price,
  change,
  changePercent,
  loading,
  onRemove,
}: {
  symbol: string;
  price: string;
  change: number;
  changePercent: number;
  loading: boolean;
  onRemove?: () => void;
}) {
  const isUp = change >= 0;
  return (
    <Card className="group relative transition-all duration-200 hover:border-[var(--color-border-accent)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          {symbol === "NIFTY" ? "NIFTY 50" : symbol}
        </p>
        {onRemove && (
          <button
            onClick={onRemove}
            title="Remove card"
            className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-status-bad)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded bg-[var(--color-bg-hover)]" />
      ) : (
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="tnum text-2xl font-black tracking-tight text-[var(--color-text-bright)]">
            ₹{price}
          </p>
          <Badge tone={isUp ? "profit" : "loss"} className="tnum shrink-0 px-2 py-0.5 text-xs font-bold">
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isUp ? "+" : ""}
            {changePercent.toFixed(2)}%
          </Badge>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { user, tradingMode } = useAuth();
  const alerts = useAlertStore((state) => state.alerts);
  const activeAlertsCount = alerts.filter((a) => a.status === "Active").length;
  const triggeredAlertsCount = alerts.filter((a) => a.status === "Triggered").length;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const { tickers, removeTicker } = useTickerStore();
  const { getTick } = useMarketData(tickers);

  const formatPrice = (val: number) => {
    return val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Welcome Banner */}
        <Card variant="glass">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight text-[var(--color-text-bright)]">
                  Welcome back, {user?.client_id || "Trader"}
                </h2>
                <Badge tone={tradingMode === "paper" ? "blue" : "loss"}>
                  {tradingMode === "paper" ? "Paper Mode" : "Live Market"}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
                Connected to{" "}
                <span className="font-bold text-[var(--color-text-primary)]">
                  {user?.broker_name || "Fyers"}
                </span>
              </p>
              {user?.connected_at && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Active Session:{" "}
                  <span className="tnum font-mono">{formatDate(user.connected_at)}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-status-good)] opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-status-good)]" />
              </span>
              <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Live Feed Active (1Hz)
              </span>
            </div>
          </div>
        </Card>

        {/* Real-time Tickers Header & Action */}
        <div>
          <div className="mb-3 flex items-center justify-between border-b border-[var(--color-border-default)] pb-2">
            <Eyebrow>Live Market Tickers & Stats</Eyebrow>
            <Button
              onClick={() => setIsModalOpen(true)}
              variant="secondary"
              size="sm"
              className="text-xs font-semibold"
            >
              <Plus className="mr-1 h-3.5 w-3.5 text-[var(--color-accent-green)]" />
              Add Ticker Card
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tickers.map((sym) => {
              const tick = getTick(sym);
              return (
                <IndexTickerCard
                  key={sym}
                  symbol={sym}
                  price={tick ? formatPrice(tick.last_price) : "—"}
                  change={tick ? tick.change : 0}
                  changePercent={tick ? tick.change_percent : 0}
                  loading={!tick}
                  onRemove={tickers.length > 1 ? () => removeTicker(sym) : undefined}
                />
              );
            })}
            <StatTile label="Active Alerts" value={activeAlertsCount} icon={BellRing} />
            <StatTile label="Triggered Today" value={triggeredAlertsCount} icon={Zap} tone="loss" />
          </div>
        </div>

        {/* Interactive Analytics Tools */}
        <div>
          <Eyebrow className="mb-4 border-b border-[var(--color-border-default)] pb-2">
            Option Analytics Cockpit
          </Eyebrow>
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

        {/* Modal */}
        <AddTickerModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </PageContainer>
    </DashboardLayout>
  );
}

