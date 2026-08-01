"use client";

import { useMemo, useState } from "react";
import { BarChart3, Loader2, Play } from "lucide-react";
import { getStoredHistoricalCandles } from "@/lib/market";
import { runStrategyBacktest, type StrategyBacktestResult } from "@/lib/strategyBacktest";
import type { StrategyLeg } from "@/lib/strategy";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

interface StrategyBacktestPanelProps {
  symbol: string;
  currentSpot: number;
  legs: StrategyLeg[];
  defaultHoldingDays?: number;
  defaultDaysToExpiry?: number;
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(value: number): string {
  return `${value >= 0 ? "+" : "-"}₹${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function EquityCurve({ result }: { result: StrategyBacktestResult }) {
  const points = useMemo(() => {
    if (result.equityCurve.length < 2) return "";
    const values = result.equityCurve.map((point) => point.equity);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    return values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${x},${y}`;
    }).join(" ");
  }, [result.equityCurve]);

  if (!points) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
        <span>Equity curve</span>
        <span>{result.equityCurve.length} completed rolls</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full overflow-visible rounded border border-[var(--color-border-default)] bg-[var(--color-bg-input)]" aria-label="Backtest equity curve">
        <polyline points={points} fill="none" stroke="var(--color-accent-blue)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function StrategyBacktestPanel({ symbol, currentSpot, legs, defaultHoldingDays = 5, defaultDaysToExpiry = 30 }: StrategyBacktestPanelProps) {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setMonth(defaultStart.getMonth() - 3);
  const [start, setStart] = useState(() => dateInputValue(defaultStart));
  const [end, setEnd] = useState(() => dateInputValue(today));
  const [holdingDays, setHoldingDays] = useState(defaultHoldingDays);
  const [daysToExpiry, setDaysToExpiry] = useState(defaultDaysToExpiry);
  const [result, setResult] = useState<StrategyBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      if (start > end) throw new Error("Start date must be on or before the end date.");
      const candles = await getStoredHistoricalCandles(symbol, start, end);
      const nextResult = runStrategyBacktest(legs, currentSpot, candles, { holdingDays, daysToExpiry });
      setResult(nextResult);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Unable to run the backtest.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            <BarChart3 className="h-3.5 w-3.5" /> Strategy backtest
          </h3>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Sequential historical rolls using stored {symbol} OHLCV. Option fills are Black-Scholes modelled at each entry and exit.</p>
        </div>
        <Button size="sm" onClick={runBacktest} disabled={loading || legs.every((leg) => !leg.instrument)}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run backtest
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-[var(--color-text-secondary)]">From
          <Input className="mt-1" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">To
          <Input className="mt-1" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">Hold (trading days)
          <Input className="mt-1" type="number" min={1} max={60} value={holdingDays} onChange={(event) => setHoldingDays(Number(event.target.value))} />
        </label>
        <label className="text-xs text-[var(--color-text-secondary)]">Fresh DTE
          <Input className="mt-1" type="number" min={1} max={365} value={daysToExpiry} onChange={(event) => setDaysToExpiry(Number(event.target.value))} />
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-loss)]">{error} Backfill historical market data for this symbol, then try again.</p>}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Net P&L" value={money(result.totalPnl)} positive={result.totalPnl >= 0} />
            <Metric label="Sharpe" value={result.sharpeRatio.toFixed(2)} positive={result.sharpeRatio >= 0} />
            <Metric label="Max drawdown" value={`${money(-result.maxDrawdown)} (${result.maxDrawdownPct.toFixed(1)}%)`} />
            <Metric label="Win rate" value={`${result.winRate.toFixed(1)}%`} positive={result.winRate >= 50} />
            <Metric label="Completed trades" value={String(result.trades.length)} />
            <Metric label="Average trade" value={money(result.averageTradePnl)} positive={result.averageTradePnl >= 0} />
          </div>
          <EquityCurve result={result} />
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div><p className="text-[10px] text-[var(--color-text-secondary)]">{label}</p><p className={`tnum mt-1 text-sm font-bold ${positive === undefined ? "text-[var(--color-text-primary)]" : positive ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}`}>{value}</p></div>;
}
