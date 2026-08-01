"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBrokerFunds,
  getBrokerHoldings,
  getBrokerPositions,
  BrokerPosition,
  BrokerHolding,
  FundsResponse,
} from "@/lib/portfolio";
import { formatApiError } from "@/lib/apiError";
import { formatINR, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { Button } from "@/components/ui/Button";
import { Landmark, RefreshCw, TrendingUp, Wallet } from "lucide-react";

const BROKER_REFRESH_INTERVAL_MS = 15_000;

function pnlTone(value: number): "profit" | "loss" | "neutral" {
  if (value > 0) return "profit";
  if (value < 0) return "loss";
  return "neutral";
}

function formatSigned(value: number): string {
  const formatted = formatINR(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

/** Real broker account state (funds, open positions, holdings) — live from
 * the connected Fyers account, distinct from the paper positions tracked
 * client-side from Strategy Builder above. Every fetch requires an active
 * broker session; a 401 here just means "not connected right now", not a
 * bug, so it renders as an empty state rather than an error banner. */
export function BrokerAccountPanel() {
  const [funds, setFunds] = useState<FundsResponse | null>(null);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [holdings, setHoldings] = useState<BrokerHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [noSession, setNoSession] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isMountedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const fetchInProgressRef = useRef(false);

  const fetchAccount = useCallback(async () => {
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;
    const isInitialLoad = !hasLoadedRef.current;

    if (isInitialLoad) setLoading(true);
    else setRefreshing(true);

    setError(null);
    setNoSession(false);

    try {
      const [fundsData, positionsData, holdingsData] = await Promise.all([
        getBrokerFunds(),
        getBrokerPositions(),
        getBrokerHoldings(),
      ]);
      if (!isMountedRef.current) return;

      setFunds(fundsData);
      setPositions(positionsData.positions);
      setHoldings(holdingsData.holdings);
      setLastUpdated(new Date());
    } catch (err) {
      if (!isMountedRef.current) return;

      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setNoSession(true);
      } else {
        setError(err);
      }
    } finally {
      fetchInProgressRef.current = false;
      if (isMountedRef.current) {
        hasLoadedRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchAccount();
    const intervalId = window.setInterval(() => void fetchAccount(), BROKER_REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [fetchAccount]);

  if (loading) {
    return (
      <Card>
        <LoadingState size="lg" label="Loading broker account…" />
      </Card>
    );
  }

  if (noSession) {
    return (
      <Card>
        <EmptyState
          title="No active broker session."
          description="Connect a broker on the Accounts page to see your real positions, holdings, and funds here."
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex flex-col gap-3">
        <EmptyState title="Failed to load live broker account." />
        <ApiErrorDisplay error={formatApiError(error)} />
      </Card>
    );
  }

  const openPositions = positions.filter((p) => p.quantity !== 0);

  return (
    <div className="flex flex-col gap-6">
      {funds && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile
            label="Available Balance"
            value={funds.available_balance != null ? formatINR(funds.available_balance) : "—"}
            icon={Wallet}
          />
          <StatTile
            label="Total Balance"
            value={funds.total_balance != null ? formatINR(funds.total_balance) : "—"}
            icon={Landmark}
          />
          <StatTile
            label="Utilized Amount"
            value={funds.utilized_amount != null ? formatINR(funds.utilized_amount) : "—"}
          />
          <StatTile
            label="Realized P&L"
            value={funds.realized_pnl != null ? formatSigned(funds.realized_pnl) : "—"}
            tone={funds.realized_pnl != null ? pnlTone(funds.realized_pnl) : "neutral"}
            icon={TrendingUp}
          />
        </div>
      )}

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Open Live Positions</h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Refreshing from your broker…"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchAccount()}
            disabled={refreshing}
            aria-label="Refresh live broker positions"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
        {openPositions.length === 0 ? (
          <EmptyState title="No open broker positions." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Avg Price</th>
                  <th className="px-4 py-3">LTP</th>
                  <th className="rounded-tr-lg px-4 py-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p) => (
                  <tr
                    key={`${p.trading_symbol}-${p.product_type}`}
                    className="border-b border-[var(--color-border-subtle)] last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{p.symbol}</td>
                    <td className="px-4 py-3">{p.product_type}</td>
                    <td className={cn(
                      "px-4 py-3",
                      p.side === "Buy"
                        ? "text-[var(--color-profit)]"
                        : p.side === "Sell"
                          ? "text-[var(--color-loss)]"
                          : "text-[var(--color-text-secondary)]"
                    )}>
                      {p.side}
                    </td>
                    <td className="tnum px-4 py-3">{Math.abs(p.quantity)}</td>
                    <td className="tnum px-4 py-3">{p.avg_price.toFixed(2)}</td>
                    <td className="tnum px-4 py-3">{p.last_price.toFixed(2)}</td>
                    <td className={cn("tnum px-4 py-3 font-semibold", pnlTone(p.pnl) === "profit" ? "text-[var(--color-profit)]" : pnlTone(p.pnl) === "loss" ? "text-[var(--color-loss)]" : "")}>
                      {formatSigned(p.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h3 className="text-sm font-bold text-[var(--color-text-bright)]">Broker Holdings</h3>
        {holdings.length === 0 ? (
          <EmptyState title="No broker holdings." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Avg Price</th>
                  <th className="px-4 py-3">LTP</th>
                  <th className="px-4 py-3">Market Value</th>
                  <th className="rounded-tr-lg px-4 py-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.trading_symbol} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{h.symbol}</td>
                    <td className="tnum px-4 py-3">{h.quantity}</td>
                    <td className="tnum px-4 py-3">{h.avg_price.toFixed(2)}</td>
                    <td className="tnum px-4 py-3">{h.last_price.toFixed(2)}</td>
                    <td className="tnum px-4 py-3">{h.market_value.toFixed(2)}</td>
                    <td className={cn("tnum px-4 py-3 font-semibold", pnlTone(h.pnl) === "profit" ? "text-[var(--color-profit)]" : pnlTone(h.pnl) === "loss" ? "text-[var(--color-loss)]" : "")}>
                      {formatSigned(h.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
