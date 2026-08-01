import { GreekChartCard } from "@/components/charts/GreekChartCard";
import { GREEK_LABEL, FEATURED_GREEKS } from "./greekLabels";
import type { GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import type { CombinedGreekSeries, GreekMetric } from "@/lib/strikeGreekAnalysis";

interface GreekPanelSectionProps {
  metrics: GreekMetric[];
  visibleGreeks: GreekMetric[];
  greekSeries: CombinedGreekSeries;
  liveContracts: number;
  totalContracts: number;
  panelLayoutFor: (metric: GreekMetric) => GreekPanelLayout;
  onLayoutChange: (metric: GreekMetric, layout: GreekPanelLayout) => void;
  onRequestAlert: (metric: GreekMetric) => void;
  syncIdPrefix: string;
  alertsDisabled?: boolean;
  alertDisabledReason?: string;
}

/** Renders one grid of Greek chart cards for whichever metric list the
 * caller passes in (the Featured row, the active Core/Higher-order tab). */
export function GreekPanelSection({
  metrics, visibleGreeks, greekSeries, liveContracts, totalContracts, panelLayoutFor, onLayoutChange, onRequestAlert, syncIdPrefix, alertsDisabled, alertDisabledReason,
}: GreekPanelSectionProps) {
  const visible = metrics.filter((metric) => visibleGreeks.includes(metric));
  if (visible.length === 0) return null;

  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {visible.map((metric) => (
        <GreekChartCard
          key={metric}
          title={GREEK_LABEL[metric]}
          metric={metric}
          points={greekSeries[metric]}
          liveContracts={liveContracts}
          totalContracts={totalContracts}
          layout={panelLayoutFor(metric)}
          syncId={`${syncIdPrefix}-${metric}`}
          onLayoutChange={(layout) => onLayoutChange(metric, layout)}
          onRequestAlert={onRequestAlert}
          alertsDisabled={alertsDisabled}
          alertDisabledReason={alertDisabledReason}
          featured={FEATURED_GREEKS.includes(metric)}
        />
      ))}
    </div>
  );
}
