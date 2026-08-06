import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExposureChart } from "@/components/dealer-flow/ExposureChart";
import type { StrikeExposure } from "@/lib/dealerFlow";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

function row(strike: number, callExposure: number, putExposure: number): StrikeExposure {
  return { strike, callExposure, putExposure, totalExposure: callExposure + putExposure };
}

describe("ExposureChart", () => {
  it("shows an empty state when every row nets to zero exposure", () => {
    render(<ExposureChart title="Vanna Profile" data={[row(24000, 0, 0)]} spotPrice={24000} />);

    expect(screen.getByText("No data available for Vanna Profile.")).toBeTruthy();
  });

  it("renders the chart and its accessible data table for non-zero rows", () => {
    const data = [row(23900, 1_000_000, -400_000), row(24000, 2_000_000, -900_000), row(24100, 500_000, -1_200_000)];
    render(<ExposureChart title="Vanna Profile" data={data} spotPrice={24000} />);

    expect(screen.getByText("Vanna Profile")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Vanna Profile bar chart across 3 strikes\. Spot price is 24000\.00/i })
    ).toBeTruthy();
    expect(screen.getByText("View Vanna Profile data table")).toBeTruthy();
  });

  it("supports zoom in/out/reset around the strike closest to spot without crashing", () => {
    const data = Array.from({ length: 9 }, (_, i) => row(23600 + i * 100, 100_000 + i, -50_000 - i));
    render(<ExposureChart title="Vanna Profile" data={data} spotPrice={24000} />);

    const zoomControls = screen.getByLabelText("Vanna Profile zoom controls");
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Zoom in Vanna Profile" }));
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Zoom out Vanna Profile" }));
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Reset Vanna Profile zoom" }));

    expect(screen.getByRole("img", { name: /bar chart across 9 strikes/i })).toBeTruthy();
  });
});
