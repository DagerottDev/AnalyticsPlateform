import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/participant-flow/ParticipantFlowCharts", () => ({
  NetOiTrendChart: () => <div>Net positioning trend</div>,
  LatestPositionChart: () => <div>Latest long / short map</div>,
  VolumeTrendChart: () => <div>Participant trading volume</div>,
  PositionChangeChart: () => <div>Daily net-position change</div>,
}));

const { getParticipantFlow } = vi.hoisted(() => ({ getParticipantFlow: vi.fn() }));
vi.mock("@/lib/participantFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/participantFlow")>()), getParticipantFlow,
}));

import ParticipantFlowPage from "@/app/participant-flow/page";
import { positionSummary } from "@/lib/participantFlow";

const metrics = (value: number) => ({
  future_index_long: value, future_index_short: value / 2,
  future_stock_long: value / 4, future_stock_short: value / 8,
  option_index_call_long: value / 3, option_index_put_long: value / 3,
  option_index_call_short: value / 4, option_index_put_short: value / 4,
  option_stock_call_long: value / 5, option_stock_put_long: value / 5,
  option_stock_call_short: value / 6, option_stock_put_short: value / 6,
  total_long: value, total_short: value / 2,
});

const response = {
  source: "NSE" as const,
  status: "ready" as const,
  latest_report_date: "2026-08-05",
  last_success_at: "2026-08-06T10:00:00Z",
  last_attempt_at: "2026-08-06T10:00:00Z",
  history_start_date: "2026-08-04",
  backfill_target_start_date: "2025-08-05",
  backfill_completed_at: "2026-08-06T10:00:00Z",
  rows: [
    { trade_date: "2026-08-04", participant_type: "FII_FPI" as const, oi: metrics(100), volume: metrics(10), net_oi: 50, net_oi_change: null },
    { trade_date: "2026-08-05", participant_type: "FII_FPI" as const, oi: metrics(140), volume: metrics(20), net_oi: 70, net_oi_change: 20 },
    { trade_date: "2026-08-05", participant_type: "CLIENT" as const, oi: metrics(60), volume: metrics(8), net_oi: 30, net_oi_change: 5 },
    { trade_date: "2026-08-05", participant_type: "DII" as const, oi: metrics(30), volume: metrics(3), net_oi: 15, net_oi_change: 2 },
    { trade_date: "2026-08-05", participant_type: "PROPRIETARY" as const, oi: metrics(50), volume: metrics(5), net_oi: 25, net_oi_change: 5 },
  ],
};

describe("Participant Flow", () => {
  beforeEach(() => {
    getParticipantFlow.mockReset();
    getParticipantFlow.mockResolvedValue(response);
  });

  it("loads the official report workspace and range controls", async () => {
    render(<ParticipantFlowPage />);

    await waitFor(() => expect(screen.getByText("Official report ready")).toBeTruthy());
    expect(screen.getByText("Latest report: 5 Aug 2026")).toBeTruthy();
    expect(screen.getByText("Net positioning trend")).toBeTruthy();
    expect(getParticipantFlow).toHaveBeenCalledWith(90);

    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    await waitFor(() => expect(getParticipantFlow).toHaveBeenCalledWith(366));
  });

  it("changes segment and participant filters without requesting broker data", async () => {
    render(<ParticipantFlowPage />);
    await waitFor(() => expect(screen.getByText("Official report ready")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByLabelText("DII"));

    expect(screen.getByRole("button", { name: "Index" }).className).toContain("text-[var(--color-accent-blue)]");
    expect(getParticipantFlow).toHaveBeenCalledTimes(1);
  });

  it("calculates selected segment/exposure net positions from official fields", () => {
    const summary = positionSummary(metrics(120), "index", "futures");
    expect(summary).toEqual({ long: 120, short: 60, net: 60 });
  });
});
