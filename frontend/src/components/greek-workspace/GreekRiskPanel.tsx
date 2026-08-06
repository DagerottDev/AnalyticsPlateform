"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { aggregateRiskExposure, atr14, priceRiskLegs, scenarioResults, type RiskLeg } from "@/lib/greekRisk";
import { formatGreekValue } from "@/lib/greekPresentation";
import type { HistoricalCandle } from "@/lib/market";
import type { Instrument, MarketTick } from "@/types/market";
import type { StrategyLeg } from "@/lib/strategy";

interface GreekRiskPanelProps {
  legs: StrategyLeg[];
  ticks: Record<string, MarketTick>;
  spot: number;
  candles: HistoricalCandle[];
  rate: number;
}

/**
 * The strategy builder owns the legs.  This panel intentionally never
 * creates a separate, analysis-only position: the scenario is always based
 * on the same sides and quantities used for payoff, margin, and paper trade.
 */
export function GreekRiskPanel({ legs, ticks, spot, candles, rate }: GreekRiskPanelProps) {
  const riskLegs = useMemo<RiskLeg[]>(() => legs.flatMap((leg) => (
    leg.instrument ? [{ instrument: leg.instrument, side: leg.action, quantity: leg.quantity }] : []
  )), [legs]);
  const priced = useMemo(() => priceRiskLegs(riskLegs, spot, ticks, rate), [riskLegs, spot, ticks, rate]);
  const exposure = useMemo(() => aggregateRiskExposure(priced), [priced]);
  const atr = atr14(candles) ?? Math.max(spot * 0.005, 1);
  const scenarios = useMemo(() => scenarioResults(priced, spot, atr, rate), [priced, spot, atr, rate]);
  const validLegs = legs.filter((leg): leg is StrategyLeg & { instrument: Instrument } => !!leg.instrument);

  if (validLegs.length === 0) {
    return <Card><h2 className="text-base font-semibold text-[var(--color-text-bright)]">Greek scenarios</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">Add a strategy leg to estimate its signed Greek exposure and ATR/volatility scenarios.</p></Card>;
  }

  return <Card className="flex flex-col gap-4"><div><h2 className="text-base font-semibold text-[var(--color-text-bright)]">Greek scenarios — My Risk</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">Uses the Strategy Legs above, including their Buy/Sell sides and quantities. Signed values are ₹ exposure estimates; mid quotes are preferred and LTP is labelled when used.</p></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-xs"><thead className="text-left text-[var(--color-text-muted)]"><tr><th>Contract</th><th>Side</th><th>Qty</th><th>Quote</th><th>Quality</th></tr></thead><tbody>{validLegs.map((leg) => <tr key={leg.id} className="border-t border-[var(--color-border-subtle)]"><td className="py-2">{leg.instrument.trading_symbol}</td><td>{leg.action}</td><td>{leg.quantity.toLocaleString()}</td><td>{priced.find((item) => item.instrument.trading_symbol === leg.instrument.trading_symbol)?.premium.toFixed(2) ?? "—"}</td><td>{priced.find((item) => item.instrument.trading_symbol === leg.instrument.trading_symbol)?.quoteQuality ?? "missing"}</td></tr>)}</tbody></table></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(["delta", "gamma", "theta", "vega"] as const).map((metric) => <div key={metric} className="rounded border border-[var(--color-border-subtle)] p-2"><p className="text-[10px] uppercase text-[var(--color-text-muted)]">₹ {metric}</p><p className="tnum font-semibold">{formatGreekValue(exposure[metric])}</p></div>)}</div>
    <div><h3 className="text-sm font-semibold">ATR-based scenario grid · 14-period ATR {atr.toFixed(2)}</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[540px] text-xs"><thead className="text-left text-[var(--color-text-muted)]"><tr><th>Scenario</th><th>Greek P&L</th><th>Full reprice P&L</th><th>Difference</th></tr></thead><tbody>{scenarios.map((scenario) => <tr key={scenario.label} className="border-t border-[var(--color-border-subtle)]"><td className="py-2">{scenario.label}</td><td>₹{scenario.approximatePnl.toFixed(2)}</td><td>₹{scenario.repricedPnl.toFixed(2)}</td><td className={Math.abs(scenario.difference) > Math.max(10, Math.abs(scenario.repricedPnl) * .2) ? "text-[var(--color-accent-orange)]" : ""}>₹{scenario.difference.toFixed(2)}</td></tr>)}</tbody></table></div></div>
  </Card>;
}
