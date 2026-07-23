"use client";

import { StrategyMetrics as MetricsType, NetGreeks } from "@/lib/strategy";
import { Card } from "@/components/ui/Card";
import { PieChart, Activity } from "lucide-react";

interface StrategyMetricsProps {
  metrics: MetricsType;
  netGreeks: NetGreeks;
  cost: number;
}

/** Below this, a value reads as exactly zero rather than a "tiny" +/- —
 * avoids coloring an untouched 0.00 (no legs yet) as profit or loss. */
const ZERO_EPSILON = 0.005;

type Tone = "profit" | "loss" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  profit: "text-[var(--color-profit)]",
  loss: "text-[var(--color-loss)]",
  neutral: "text-[var(--color-text-bright)]",
};

function toneForSigned(val: number): Tone {
  if (val > ZERO_EPSILON) return "profit";
  if (val < -ZERO_EPSILON) return "loss";
  return "neutral";
}

/** Cost sign is inverted vs. a plain signed value: paying (positive cost) is
 * the unfavorable side, receiving (negative cost) is favorable. */
function toneForCost(cost: number): Tone {
  if (cost > ZERO_EPSILON) return "loss";
  if (cost < -ZERO_EPSILON) return "profit";
  return "neutral";
}

export function StrategyMetrics({ metrics, netGreeks, cost }: StrategyMetricsProps) {

  const formatMoney = (val: number | "Unlimited") => {
    if (val === "Unlimited") return "Unlimited";
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  const formatGreek = (val: number) => {
    return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
  };

  const maxProfitTone: Tone = metrics.maxProfit === "Unlimited" ? "profit" : toneForSigned(metrics.maxProfit);
  const maxLossTone: Tone = metrics.maxLoss === "Unlimited" ? "loss" : toneForSigned(metrics.maxLoss);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {/* PnL Profile */}
      <Card className="col-span-2 flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          <PieChart className="h-3.5 w-3.5" /> Risk Profile
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Profit</div>
            <div className={`tnum mt-1 text-lg font-bold ${TONE_CLASS[maxProfitTone]}`}>
              {formatMoney(metrics.maxProfit)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">Max Loss</div>
            <div className={`tnum mt-1 text-lg font-bold ${TONE_CLASS[maxLossTone]}`}>
              {formatMoney(metrics.maxLoss)}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">Net Cost/Credit</div>
            <div className={`tnum mt-1 text-lg font-bold ${TONE_CLASS[toneForCost(cost)]}`}>
              {cost > ZERO_EPSILON ? `Pay ${cost.toFixed(2)}` : cost < -ZERO_EPSILON ? `Receive ${Math.abs(cost).toFixed(2)}` : "0.00"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--color-text-secondary)]">Breakevens</div>
            <div className="tnum mt-1 text-sm font-bold text-[var(--color-text-bright)]">
              {metrics.breakevens.length > 0 ? metrics.breakevens.join(", ") : "None"}
            </div>
          </div>
        </div>
      </Card>

      {/* Net Greeks */}
      <Card className="col-span-2 flex flex-col gap-4">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          <Activity className="h-3.5 w-3.5" /> Net Greeks
        </h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Delta</div>
            <div className={`tnum mt-2 font-mono text-sm font-bold ${TONE_CLASS[toneForSigned(netGreeks.netDelta)]}`}>
              {formatGreek(netGreeks.netDelta)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Gamma</div>
            <div className={`tnum mt-2 font-mono text-sm font-bold ${TONE_CLASS[toneForSigned(netGreeks.netGamma)]}`}>
              {formatGreek(netGreeks.netGamma)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Theta</div>
            <div className={`tnum mt-2 font-mono text-sm font-bold ${TONE_CLASS[toneForSigned(netGreeks.netTheta)]}`}>
              {formatGreek(netGreeks.netTheta)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-[var(--color-text-secondary)]">Net Vega</div>
            <div className={`tnum mt-2 font-mono text-sm font-bold ${TONE_CLASS[toneForSigned(netGreeks.netVega)]}`}>
              {formatGreek(netGreeks.netVega)}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
