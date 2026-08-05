import { StrictMode, useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IChartApi, Time } from "lightweight-charts";
import { GreekChartSyncProvider, useGreekChartSync } from "@/components/greek-workspace/GreekChartSyncProvider";

function createChartStub(): IChartApi {
  return {
    timeScale: () => ({ getVisibleRange: () => null }),
  } as unknown as IChartApi;
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
});
