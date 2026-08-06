import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GreekPanelSection } from "@/components/greek-workspace/GreekPanelSection";
import type { GreekPanelLayout } from "@/lib/greekWorkspaceLayout";
import type { CombinedGreekSeries, GreekMetric } from "@/lib/strikeGreekAnalysis";

// GreekChartCard is a heavy chart component (wraps GreekLineChart, which
// itself wraps lightweight-charts) that is out of scope for this directory —
// stub it so these tests exercise only GreekPanelSection's own filtering and
// prop-forwarding logic, and assert on the props it actually receives.
vi.mock("@/components/charts/GreekChartCard", () => ({
  GreekChartCard: (props: {
    title: string;
    metric: GreekMetric;
    liveContracts: number;
    totalContracts: number;
    alertsDisabled?: boolean;
    onRequestAlert: (metric: GreekMetric) => void;
  }) => (
    <div data-testid={`chart-${props.metric}`}>
      {props.title} · live {props.liveContracts}/{props.totalContracts} · alerts {props.alertsDisabled ? "off" : "on"}
      <button onClick={() => props.onRequestAlert(props.metric)}>Alert {props.metric}</button>
    </div>
  ),
}));

const LAYOUT: GreekPanelLayout = { overlay: "none", period: 10, multiplier: 2 };

function series(metrics: GreekMetric[]): CombinedGreekSeries {
  return Object.fromEntries(metrics.map((metric) => [metric, [{ time: "09:15", value: 1 }]])) as CombinedGreekSeries;
}

describe("GreekPanelSection", () => {
  it("renders nothing when no metric in the list is currently visible", () => {
    const { container } = render(
      <GreekPanelSection
        metrics={["delta", "gamma"]}
        visibleGreeks={["theta"]}
        greekSeries={series(["delta", "gamma", "theta"])}
        liveContracts={2}
        totalContracts={2}
        panelLayoutFor={() => LAYOUT}
        onLayoutChange={vi.fn()}
        onRequestAlert={vi.fn()}
        syncIdPrefix="core"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders one chart card per visible metric in the given list, in order", () => {
    render(
      <GreekPanelSection
        metrics={["delta", "gamma", "theta"]}
        visibleGreeks={["theta", "delta"]}
        greekSeries={series(["delta", "gamma", "theta"])}
        liveContracts={3}
        totalContracts={4}
        panelLayoutFor={() => LAYOUT}
        onLayoutChange={vi.fn()}
        onRequestAlert={vi.fn()}
        syncIdPrefix="core"
      />
    );

    // Only delta and theta are visible; gamma is filtered out even though
    // it's in the metrics list. Order follows `metrics`, not `visibleGreeks`.
    expect(screen.getByTestId("chart-delta")).toBeTruthy();
    expect(screen.getByTestId("chart-theta")).toBeTruthy();
    expect(screen.queryByTestId("chart-gamma")).toBeNull();
    expect(screen.getAllByText(/live 3\/4/)).toHaveLength(2);
  });

  it("forwards alert-disabled state and the per-metric alert request", () => {
    const onRequestAlert = vi.fn();
    render(
      <GreekPanelSection
        metrics={["delta"]}
        visibleGreeks={["delta"]}
        greekSeries={series(["delta"])}
        liveContracts={1}
        totalContracts={1}
        panelLayoutFor={() => LAYOUT}
        onLayoutChange={vi.fn()}
        onRequestAlert={onRequestAlert}
        syncIdPrefix="core"
        alertsDisabled
        alertDisabledReason="Live trading required"
      />
    );

    expect(screen.getByText(/alerts off/)).toBeTruthy();
    screen.getByText("Alert delta").click();
    expect(onRequestAlert).toHaveBeenCalledWith("delta");
  });
});
