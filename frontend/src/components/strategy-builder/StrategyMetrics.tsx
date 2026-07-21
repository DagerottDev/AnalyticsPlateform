"use client";

import { StrategyMetrics as MetricsType, NetGreeks } from "@/lib/strategy";
import { Card } from "@/components/ui/Card";

interface StrategyMetricsProps {
  metrics: MetricsType;
  netGreeks: NetGreeks;
  cost: number;
}

export function StrategyMetrics({ metrics, netGreeks, cost }: StrategyMetricsProps) {

  const formatMoney = (val: number | "Unlimited") => {
    if (val === "Unlimited") return "Unlimited";
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  const formatGreek = (val: number) => {
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {/* PnL Profile */}
      <Card className="col-span-2 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Profit</div>
          <div className="tnum mt-1 text-lg font-bold text-[var(--color-profit)]">
            {formatMoney(metrics.maxProfit)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Loss</div>
          <div className="tnum mt-1 text-lg font-bold text-[var(--color-loss)]">
            {formatMoney(metrics.maxLoss)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Net Cost/Credit</div>
          <div className={`tnum mt-1 text-lg font-bold ${cost > 0 ? "text-[var(--color-loss)]" : "text-[var(--color-profit)]"}`}>
            {cost > 0 ? `Pay ${cost.toFixed(2)}` : `Receive ${Math.abs(cost).toFixed(2)}`}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Breakevens</div>
          <div className="tnum mt-1 text-sm font-bold text-[var(--color-text-bright)]">
            {metrics.breakevens.length > 0 ? metrics.breakevens.join(", ") : "None"}
          </div>
        </div>
      </Card>

      {/* Net Greeks */}
      <Card className="col-span-2 grid grid-cols-4 gap-4 text-center">
        <div>
          <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Delta</div>
          <div className={`tnum mt-2 font-mono text-sm font-bold ${netGreeks.netDelta > 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}`}>
            {formatGreek(netGreeks.netDelta)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Gamma</div>
          <div className={`tnum mt-2 font-mono text-sm font-bold ${netGreeks.netGamma > 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}`}>
            {formatGreek(netGreeks.netGamma)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Theta</div>
          <div className={`tnum mt-2 font-mono text-sm font-bold ${netGreeks.netTheta > 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}`}>
            {formatGreek(netGreeks.netTheta)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Vega</div>
          <div className={`tnum mt-2 font-mono text-sm font-bold ${netGreeks.netVega > 0 ? "text-[var(--color-profit)]" : "text-[var(--color-loss)]"}`}>
            {formatGreek(netGreeks.netVega)}
          </div>
        </div>
      </Card>
    </div>
  );
}
