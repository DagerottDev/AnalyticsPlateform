"use client";

import { Fragment, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePositionStore, Position } from "@/stores/positionStore";
import { useMarketData } from "@/hooks/useMarketData";
import { MarketTick } from "@/types/market";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { timeToExpiry, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
import { calculatePaperAccountSummary } from "@/lib/paperTrading";
import { formatDate, cn } from "@/lib/utils";
import { BrokerAccountPanel } from "@/components/positions/BrokerAccountPanel";
import {
  Activity,
  Briefcase,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Trash2,
  XCircle,
  Wallet,
} from "lucide-react";

interface PositionSnapshot {
  markValue: number;
  pnl: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  ready: boolean;
}

/** Marks one position to live prices and sums its legs' Greeks — each leg
 * priced off its own instrument's live IV (back-solved from its own live
 * premium), not a single strategy-wide assumption. Aggregating these across
 * every open position (across strategies, across underlyings) is what turns
 * this from a per-strategy view into a whole-book risk view. */
function evaluatePosition(position: Position, getTick: (symbol: string) => MarketTick | null): PositionSnapshot {
  let markValue = 0;
  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;
  let ready = true;

  position.legs.forEach(leg => {
    if (!leg.instrument) { ready = false; return; }
    const tick = getTick(leg.instrument.trading_symbol);
    if (!tick) { ready = false; return; }

    const sign = leg.action === "Buy" ? 1 : -1;
    markValue += tick.last_price * leg.quantity * sign;

    if (leg.instrument.strike && leg.instrument.option_type && leg.instrument.expiry) {
      const underlyingTick = getTick(leg.instrument.symbol);
      const S = underlyingTick?.last_price || defaultSpotFallback(leg.instrument.symbol);
      const T = timeToExpiry(leg.instrument.expiry);
      const optionType = leg.instrument.option_type as "CE" | "PE";
      const iv = calculateImpliedVolatility(optionType, S, leg.instrument.strike, T, DEFAULT_RISK_FREE_RATE, tick.last_price);
      if (iv > 0) {
        const greeks = calculateGreeks(optionType, S, leg.instrument.strike, T, DEFAULT_RISK_FREE_RATE, iv);
        netDelta += greeks.delta * leg.quantity * sign;
        netGamma += greeks.gamma * leg.quantity * sign;
        netTheta += greeks.theta * leg.quantity * sign;
        netVega += greeks.vega * leg.quantity * sign;
      }
    }
  });

  return { markValue, pnl: markValue - position.entryCost, netDelta, netGamma, netTheta, netVega, ready };
}

/** Below this, a value reads as exactly zero rather than a "tiny" +/- —
 * avoids coloring an untouched 0.00 as profit or loss. Mirrors
 * StrategyMetrics' epsilon so a position's Greeks read consistently
 * whether viewed per-strategy or aggregated across the whole book. */
const ZERO_EPSILON = 0.005;

function greekTone(val: number): "profit" | "loss" | "neutral" {
  if (val > ZERO_EPSILON) return "profit";
  if (val < -ZERO_EPSILON) return "loss";
  return "neutral";
}

const GREEK_TONE_CLASS: Record<"profit" | "loss" | "neutral", string> = {
  profit: "text-[var(--color-profit)]",
  loss: "text-[var(--color-loss)]",
  neutral: "text-[var(--color-text-bright)]",
};

function formatGreek(val: number): string {
  return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
}

function formatMoney(val: number): string {
  return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
}

export default function PositionsPage() {
  const { positions, closePosition, removePosition, clearClosed } = usePositionStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const openPositions = useMemo(() => positions.filter(p => p.status === "Open"), [positions]);
  const closedPositions = useMemo(() => positions.filter(p => p.status === "Closed"), [positions]);

  const tradingSymbols = useMemo(() => {
    const syms = new Set<string>();
    openPositions.forEach(p => {
      p.legs.forEach(leg => {
        if (!leg.instrument) return;
        syms.add(leg.instrument.trading_symbol);
        if (leg.instrument.symbol) syms.add(leg.instrument.symbol);
      });
    });
    return Array.from(syms);
  }, [openPositions]);

  const { getTick } = useMarketData(tradingSymbols);

  const snapshots = useMemo(() => {
    const map = new Map<string, PositionSnapshot>();
    openPositions.forEach(p => map.set(p.id, evaluatePosition(p, getTick)));
    return map;
  }, [openPositions, getTick]);

  const totalUnrealizedPnl = useMemo(
    () => openPositions.reduce((sum, p) => sum + (snapshots.get(p.id)?.pnl || 0), 0),
    [openPositions, snapshots]
  );
  const totalNetDelta = useMemo(
    () => openPositions.reduce((sum, p) => sum + (snapshots.get(p.id)?.netDelta || 0), 0),
    [openPositions, snapshots]
  );
  const totalNetGamma = useMemo(
    () => openPositions.reduce((sum, p) => sum + (snapshots.get(p.id)?.netGamma || 0), 0),
    [openPositions, snapshots]
  );
  const totalNetTheta = useMemo(
    () => openPositions.reduce((sum, p) => sum + (snapshots.get(p.id)?.netTheta || 0), 0),
    [openPositions, snapshots]
  );
  const totalNetVega = useMemo(
    () => openPositions.reduce((sum, p) => sum + (snapshots.get(p.id)?.netVega || 0), 0),
    [openPositions, snapshots]
  );
  const capitalDeployed = useMemo(
    () => openPositions.reduce((sum, p) => sum + p.entryCost, 0),
    [openPositions]
  );
  const totalRealizedPnl = useMemo(
    () => closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0),
    [closedPositions]
  );
  const paperAccount = useMemo(() => calculatePaperAccountSummary({
    openEntryCost: capitalDeployed,
    closedCloseValue: closedPositions.reduce((sum, p) => sum + (p.closeValue || 0), 0),
    realizedPnl: totalRealizedPnl,
    unrealizedPnl: totalUnrealizedPnl,
  }), [capitalDeployed, closedPositions, totalRealizedPnl, totalUnrealizedPnl]);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleClose = (position: Position) => {
    const snapshot = snapshots.get(position.id);
    if (!snapshot || !snapshot.ready) return;
    closePosition(position.id, snapshot.markValue);
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <SectionHeader
          title="Positions"
          description="Paper orders filled from the Strategy Builder, marked to live prices."
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Open Positions" value={openPositions.length} icon={Briefcase} />
          <StatTile
            label="Running P&L"
            value={formatMoney(paperAccount.runningPnl)}
            tone={paperAccount.runningPnl >= 0 ? "profit" : "loss"}
          />
          <StatTile label="Net Delta" value={formatMoney(totalNetDelta)} />
          <StatTile label="Paper Equity" value={paperAccount.equity.toFixed(2)} icon={Wallet} />
        </div>

        {/* Portfolio Greeks — net exposure summed across every open position
            (across strategies, across underlyings), not just one Strategy
            Builder session. */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            <Activity className="h-3.5 w-3.5" /> Portfolio Greeks
          </h3>
          <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
            <div>
              <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Delta</div>
              <div className={cn("tnum mt-2 font-mono text-lg font-bold", GREEK_TONE_CLASS[greekTone(totalNetDelta)])}>
                {formatGreek(totalNetDelta)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Gamma</div>
              <div className={cn("tnum mt-2 font-mono text-lg font-bold", GREEK_TONE_CLASS[greekTone(totalNetGamma)])}>
                {formatGreek(totalNetGamma)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Theta</div>
              <div className={cn("tnum mt-2 font-mono text-lg font-bold", GREEK_TONE_CLASS[greekTone(totalNetTheta)])}>
                {formatGreek(totalNetTheta)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Vega</div>
              <div className={cn("tnum mt-2 font-mono text-lg font-bold", GREEK_TONE_CLASS[greekTone(totalNetVega)])}>
                {formatGreek(totalNetVega)}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Running P&amp;L includes {formatMoney(paperAccount.realizedPnl)} realized and {formatMoney(paperAccount.unrealizedPnl)} unrealized P&amp;L across {openPositions.length} open position{openPositions.length === 1 ? "" : "s"}.
          </p>
        </Card>

        {/* Open Positions */}
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
            <Briefcase className="h-4 w-4 text-[var(--color-accent-blue)]" /> Open Positions
          </h3>

          {openPositions.length === 0 ? (
            <EmptyState
              title="No open positions."
              description={'Build a strategy and click "Execute Paper Trade" to simulate fills and start tracking it here.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
                <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="rounded-tl-lg px-4 py-3"></th>
                    <th className="px-4 py-3">Position</th>
                    <th className="px-4 py-3">Entry Cost</th>
                    <th className="px-4 py-3">Mark Value</th>
                    <th className="px-4 py-3">P&L</th>
                    <th className="px-4 py-3">Net Delta</th>
                    <th className="px-4 py-3">Opened</th>
                    <th className="rounded-tr-lg px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map(position => {
                    const snapshot = snapshots.get(position.id);
                    const isExpanded = expanded.has(position.id);

                    return (
                      <Fragment key={position.id}>
                        <tr
                          className="cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-hover)]"
                          onClick={() => toggleExpanded(position.id)}
                        >
                          <td className="px-4 py-3">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">
                            <div className="flex items-center gap-2"><span>{position.label}</span><Badge tone="blue">Paper</Badge></div>
                          </td>
                          <td className="tnum px-4 py-3">
                            {position.entryCost > 0 ? `Pay ${position.entryCost.toFixed(2)}` : `Receive ${Math.abs(position.entryCost).toFixed(2)}`}
                          </td>
                          <td className="tnum px-4 py-3">
                            {snapshot?.ready ? snapshot.markValue.toFixed(2) : <span className="text-[var(--color-text-muted)]">Loading…</span>}
                          </td>
                          <td className={cn("tnum px-4 py-3 font-semibold", snapshot && snapshot.pnl >= 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]")}>
                            {snapshot?.ready ? formatMoney(snapshot.pnl) : "-"}
                          </td>
                          <td className="tnum px-4 py-3">{snapshot?.ready ? formatMoney(snapshot.netDelta) : "-"}</td>
                          <td className="tnum px-4 py-3 text-xs">{new Date(position.openedAt).toLocaleString()}</td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="icon"
                                onClick={() => handleClose(position)}
                                disabled={!snapshot?.ready}
                                aria-label="Close position"
                                title="Close at current mark"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                              <Button variant="icon" onClick={() => removePosition(position.id)} aria-label="Delete position">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/40 last:border-0">
                            <td></td>
                            <td colSpan={7} className="px-4 py-3">
                              <table className="w-full text-xs">
                                <thead className="text-[var(--color-text-muted)]">
                                  <tr>
                                    <th className="py-1 text-left font-medium">Leg</th>
                                    <th className="py-1 text-left font-medium">Qty</th>
                                    <th className="py-1 text-left font-medium">Entry</th>
                                    <th className="py-1 text-left font-medium">Fill Time</th>
                                    <th className="py-1 text-left font-medium">Mark</th>
                                    <th className="py-1 text-left font-medium">Leg P&L</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {position.legs.map(leg => {
                                    const fill = position.fills?.find(item => item.legId === leg.id);
                                    const tick = leg.instrument ? getTick(leg.instrument.trading_symbol) : null;
                                    const mark = tick?.last_price;
                                    const sign = leg.action === "Buy" ? 1 : -1;
                                    const legPnl = typeof mark === "number" ? (mark - leg.entryPrice) * leg.quantity * sign : null;

                                    return (
                                      <tr key={leg.id}>
                                        <td className="py-1 text-[var(--color-text-primary)]">
                                          <span className={leg.action === "Buy" ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}>{leg.action}</span>{" "}
                                          {leg.instrument?.strike} {leg.instrument?.option_type}
                                        </td>
                                        <td className="tnum py-1">{leg.quantity}</td>
                                        <td className="tnum py-1">{leg.entryPrice.toFixed(2)}</td>
                                        <td className="py-1">{fill ? new Date(fill.filledAt).toLocaleTimeString() : "Legacy"}</td>
                                        <td className="tnum py-1">{typeof mark === "number" ? mark.toFixed(2) : "-"}</td>
                                        <td className={cn("tnum py-1", legPnl !== null && (legPnl >= 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"))}>
                                          {legPnl !== null ? formatMoney(legPnl) : "-"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Closed Positions History */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-bright)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--color-status-good)]" /> Closed Positions
            </h3>
            {closedPositions.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearClosed}>
                Clear History
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[var(--color-text-secondary)]">
              <thead className="bg-[var(--color-bg-hover)] text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="rounded-tl-lg px-4 py-3">Position</th>
                  <th className="px-4 py-3">Entry Cost</th>
                  <th className="px-4 py-3">Close Value</th>
                  <th className="px-4 py-3">Realized P&L</th>
                  <th className="rounded-tr-lg px-4 py-3">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closedPositions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No closed positions yet." />
                    </td>
                  </tr>
                ) : (
                  closedPositions.map(position => (
                    <tr key={position.id} className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-hover)]">
                      <td className="px-4 py-3 font-medium text-[var(--color-text-bright)]">{position.label}</td>
                      <td className="tnum px-4 py-3 opacity-75">{position.entryCost.toFixed(2)}</td>
                      <td className="tnum px-4 py-3 opacity-75">{position.closeValue?.toFixed(2) ?? "-"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={(position.realizedPnl || 0) >= 0 ? "profit" : "loss"}>
                          {formatMoney(position.realizedPnl || 0)}
                        </Badge>
                      </td>
                      <td className="tnum px-4 py-3 text-xs text-[var(--color-status-good)]">
                        {position.closedAt ? formatDate(position.closedAt) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Broker Account — real positions/holdings/funds pulled live from
            the connected Fyers account, distinct from the paper positions
            simulated above. */}
        <SectionHeader
          title="Broker Account"
          description="Real positions, holdings, and funds from your connected broker."
        />
        <BrokerAccountPanel />
      </PageContainer>
    </DashboardLayout>
  );
}
