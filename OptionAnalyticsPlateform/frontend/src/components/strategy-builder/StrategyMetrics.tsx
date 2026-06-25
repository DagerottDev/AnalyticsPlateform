"use client";

import { StrategyMetrics as MetricsType } from "@/lib/strategy";

interface StrategyMetricsProps {
  metrics: MetricsType;
  cost: number;
}

export function StrategyMetrics({ metrics, cost }: StrategyMetricsProps) {
  
  const formatMoney = (val: number) => {
    if (val === Infinity) return "Unlimited";
    if (val === -Infinity) return "Unlimited Loss";
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  const formatGreek = (val: number) => {
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* PnL Profile */}
      <div className="col-span-2 grid grid-cols-2 gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-sm">
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Profit</div>
          <div className="mt-1 text-lg font-bold text-[var(--color-accent-green)]">
            {formatMoney(metrics.maxProfit)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Loss</div>
          <div className="mt-1 text-lg font-bold text-[var(--color-accent-red)]">
            {formatMoney(metrics.maxLoss)}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Net Cost/Credit</div>
          <div className={`mt-1 text-lg font-bold ${cost > 0 ? 'text-[var(--color-accent-red)]' : 'text-[var(--color-accent-green)]'}`}>
            {cost > 0 ? `Pay ${cost.toFixed(2)}` : `Receive ${Math.abs(cost).toFixed(2)}`}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Breakevens</div>
          <div className="mt-1 text-sm font-bold text-[var(--color-text-bright)]">
            {metrics.breakevens.length > 0 ? metrics.breakevens.join(", ") : "None"}
          </div>
        </div>
      </div>

      {/* Net Greeks */}
      <div className="col-span-2 grid grid-cols-4 gap-4 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-sm text-center">
        <div>
          <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">Net Delta</div>
          <div className={`mt-2 text-sm font-bold font-mono ${metrics.netDelta > 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-red)]'}`}>
            {formatGreek(metrics.netDelta)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">Net Gamma</div>
          <div className={`mt-2 text-sm font-bold font-mono ${metrics.netGamma > 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-red)]'}`}>
            {formatGreek(metrics.netGamma)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">Net Theta</div>
          <div className={`mt-2 text-sm font-bold font-mono ${metrics.netTheta > 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-red)]'}`}>
            {formatGreek(metrics.netTheta)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">Net Vega</div>
          <div className={`mt-2 text-sm font-bold font-mono ${metrics.netVega > 0 ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-accent-red)]'}`}>
            {formatGreek(metrics.netVega)}
          </div>
        </div>
      </div>
    </div>
  );
}
