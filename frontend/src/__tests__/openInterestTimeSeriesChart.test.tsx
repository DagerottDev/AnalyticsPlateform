import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenInterestTimeSeriesChart } from "@/components/open-interest/OpenInterestTimeSeriesChart";
import type { OpenInterestSnapshot } from "@/lib/market";

// lightweight-charts' real createChart() needs a real canvas 2D context and
// window.matchMedia, neither of which jsdom implements — it throws deep
// inside fancy-canvas during both mount and unmount otherwise. Stub the
// module with a minimal fake chart exposing just the surface this component
// actually calls (timeScale range sync, line series, resize, remove).
function fakeSeries() {
  return { setData: vi.fn() };
}
function fakeChart() {
  return {
    timeScale: () => ({
      subscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      getVisibleRange: () => null,
      setVisibleRange: vi.fn(),
      getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      setVisibleLogicalRange: vi.fn(),
      fitContent: vi.fn(),
    }),
    addLineSeries: vi.fn(() => fakeSeries()),
    removeSeries: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  };
}
const createChartMock = vi.hoisted(() => vi.fn());
vi.mock("lightweight-charts", () => ({
  createChart: createChartMock,
}));
createChartMock.mockImplementation(() => fakeChart());

function point(timestamp: string, callOi: number, putOi: number): OpenInterestSnapshot {
  return { timestamp, total_call_oi: callOi, total_put_oi: putOi, total_call_change: callOi / 10, total_put_change: putOi / 10 };
}

describe("OpenInterestTimeSeriesChart", () => {
  beforeEach(() => createChartMock.mockClear());

  it("shows an empty state before the first snapshot", () => {
    render(<OpenInterestTimeSeriesChart points={[]} scheduledTracking={false} />);

    expect(screen.getByText("Live OI history will appear after the first option-chain snapshot.")).toBeTruthy();
    expect(createChartMock).not.toHaveBeenCalled();
  });

  it("renders both live time-series panels once snapshots exist", () => {
    const points = [point("2026-08-06T09:15:00Z", 1000, 900), point("2026-08-06T09:20:00Z", 1100, 950)];
    render(<OpenInterestTimeSeriesChart points={points} scheduledTracking />);

    expect(screen.getByText("Live Call vs Put OI")).toBeTruthy();
    expect(screen.getByText("Total Open Interest")).toBeTruthy();
    expect(screen.getByText("Session OI Change")).toBeTruthy();
    expect(screen.getByText("View live call versus put open interest data table")).toBeTruthy();
    expect(createChartMock).toHaveBeenCalledTimes(2);
  });

  it("shows the partial-history notice only when tracking isn't scheduled and the session isn't fully covered", () => {
    const points = [point("2026-08-06T11:00:00Z", 1000, 900)];
    const { rerender } = render(<OpenInterestTimeSeriesChart points={points} scheduledTracking={false} />);

    expect(screen.getByText(/History for this expiry starts from its first observation/i)).toBeTruthy();

    rerender(<OpenInterestTimeSeriesChart points={points} scheduledTracking />);
    expect(screen.queryByText(/History for this expiry starts from its first observation/i)).toBeNull();
  });
});
