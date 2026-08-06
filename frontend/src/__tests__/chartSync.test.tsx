import { StrictMode, useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IChartApi, Range, Time } from "lightweight-charts";
import { GreekChartSyncProvider, useGreekChartSync } from "@/components/greek-workspace/GreekChartSyncProvider";

function createChartStub(): IChartApi {
  return {
    timeScale: () => ({ getVisibleRange: () => null }),
  } as unknown as IChartApi;
}

/** A chart stub whose `setVisibleRange` calls are independently spy-able —
 * needed for the range-sync (as opposed to crosshair-sync) tests below. */
function createRangeChartStub() {
  const setVisibleRange = vi.fn();
  const chart = {
    timeScale: () => ({ getVisibleRange: () => null, setVisibleRange }),
  } as unknown as IChartApi;
  return { chart, setVisibleRange };
}

function ChartRegistration({ id, chart, onCrosshair }: { id: string; chart: IChartApi; onCrosshair: (time: Time | null) => void }) {
  const { registerChart } = useGreekChartSync();
  useEffect(() => registerChart(id, chart, onCrosshair), [chart, id, onCrosshair, registerChart]);
  return null;
}

function CrosshairControls() {
  const { notifyCrosshair } = useGreekChartSync();
  return (
    <>
      <button type="button" onClick={() => notifyCrosshair("source", 1_700_000_000 as Time)}>Move crosshair</button>
      <button type="button" onClick={() => notifyCrosshair("source", null)}>Clear crosshair</button>
    </>
  );
}

describe("workspace chart synchronization", () => {
  it("mirrors crosshair time and remains single-registered through Strict Mode replay", () => {
    const source = vi.fn();
    const target = vi.fn();
    render(
      <StrictMode>
        <GreekChartSyncProvider enabled>
          <ChartRegistration id="source" chart={createChartStub()} onCrosshair={source} />
          <ChartRegistration id="target" chart={createChartStub()} onCrosshair={target} />
          <CrosshairControls />
        </GreekChartSyncProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move crosshair" }));
    expect(source).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenLastCalledWith(1_700_000_000);

    fireEvent.click(screen.getByRole("button", { name: "Clear crosshair" }));
    expect(target).toHaveBeenLastCalledWith(null);
  });

  it("does not broadcast while chart synchronization is disabled", () => {
    const target = vi.fn();
    render(
      <GreekChartSyncProvider enabled={false}>
        <ChartRegistration id="target" chart={createChartStub()} onCrosshair={target} />
        <CrosshairControls />
      </GreekChartSyncProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move crosshair" }));
    expect(target).not.toHaveBeenCalled();
  });

  it("propagates a source chart's visible range to every other registered chart, but not back to the source", () => {
    const a = createRangeChartStub();
    const b = createRangeChartStub();
    function RangeControls() {
      const { registerChart, notifyTimeRange } = useGreekChartSync();
      useEffect(() => registerChart("a", a.chart), [registerChart]);
      useEffect(() => registerChart("b", b.chart), [registerChart]);
      return (
        <button type="button" onClick={() => notifyTimeRange("a", { from: 1 as Time, to: 2 as Time })}>
          Move range
        </button>
      );
    }
    render(
      <GreekChartSyncProvider enabled>
        <RangeControls />
      </GreekChartSyncProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move range" }));

    expect(a.setVisibleRange).not.toHaveBeenCalled();
    expect(b.setVisibleRange).toHaveBeenCalledWith({ from: 1, to: 2 });
  });

  it("does not propagate a range change while chart synchronization is disabled", () => {
    const b = createRangeChartStub();
    function RangeControls() {
      const { registerChart, notifyTimeRange } = useGreekChartSync();
      useEffect(() => registerChart("b", b.chart), [registerChart]);
      return (
        <button type="button" onClick={() => notifyTimeRange("a", { from: 1 as Time, to: 2 as Time })}>
          Move range
        </button>
      );
    }
    render(
      <GreekChartSyncProvider enabled={false}>
        <RangeControls />
      </GreekChartSyncProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move range" }));

    expect(b.setVisibleRange).not.toHaveBeenCalled();
  });

  it("guards against a feedback loop when a target chart synchronously re-emits its own range change", () => {
    // Simulates lightweight-charts calling back into notifyTimeRange from
    // inside setVisibleRange (as its own subscribeVisibleTimeRangeChange
    // would fire on a real chart) — the applyingRangeRef guard in
    // GreekChartSyncProvider must swallow that reentrant call, or two
    // charts syncing each other would loop forever.
    const a = createRangeChartStub();
    const b = createRangeChartStub();
    let notifyTimeRange: (sourceId: string, range: Range<Time> | null) => void = () => undefined;
    b.setVisibleRange.mockImplementation(() => {
      notifyTimeRange("b", { from: 99 as Time, to: 100 as Time });
    });
    function RangeControls() {
      const ctx = useGreekChartSync();
      notifyTimeRange = ctx.notifyTimeRange;
      useEffect(() => ctx.registerChart("a", a.chart), [ctx]);
      useEffect(() => ctx.registerChart("b", b.chart), [ctx]);
      return (
        <button type="button" onClick={() => ctx.notifyTimeRange("a", { from: 1 as Time, to: 2 as Time })}>
          Move range
        </button>
      );
    }
    render(
      <GreekChartSyncProvider enabled>
        <RangeControls />
      </GreekChartSyncProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move range" }));

    // The outer "a" -> "b" propagation happened once; "b"'s synchronous
    // reentrant "b" -> "a" notification was suppressed by the guard, so "a"
    // never received a setVisibleRange call at all.
    expect(b.setVisibleRange).toHaveBeenCalledTimes(1);
    expect(a.setVisibleRange).not.toHaveBeenCalled();
  });
});
