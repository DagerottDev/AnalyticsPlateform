import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GEXProfileChart } from "@/components/dealer-flow/GEXProfileChart";
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

describe("GEXProfileChart", () => {
  it("shows an empty state when there is no non-zero GEX data", () => {
    render(<GEXProfileChart data={[row(24000, 0, 0)]} spotPrice={24000} />);

    expect(screen.getByText("No GEX data available.")).toBeTruthy();
  });

  it("renders the GEX profile chart and data table for non-zero rows", () => {
    const data = [row(23900, 1_500_000, -800_000), row(24000, 3_000_000, -1_100_000), row(24100, 900_000, -2_400_000)];
    render(<GEXProfileChart data={data} spotPrice={24000} />);

    expect(screen.getByText("Gamma Exposure (GEX) Profile")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Gamma exposure profile across 3 strikes\. Spot price is 24000\.00/i })
    ).toBeTruthy();
    expect(screen.getByText("View gamma exposure profile data table")).toBeTruthy();
  });

  it("supports zoom in/out/reset around the strike nearest to spot without crashing", () => {
    const data = Array.from({ length: 9 }, (_, i) => row(23600 + i * 100, 100_000 + i * 1000, -(50_000 + i * 500)));
    render(<GEXProfileChart data={data} spotPrice={24000} />);

    const zoomControls = screen.getByLabelText("gamma exposure profile zoom controls");

    // The chart's aria-label and data table always describe the full dataset
    // (zoom only narrows what recharts actually renders in the SVG), so the
    // observable, stable assertion here is that repeated zoom interactions
    // don't throw and the surrounding chrome stays intact.
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Zoom in gamma exposure profile" }));
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Zoom in gamma exposure profile" }));
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Zoom out gamma exposure profile" }));
    fireEvent.click(within(zoomControls).getByRole("button", { name: "Reset gamma exposure profile zoom" }));

    expect(screen.getByRole("img", { name: /across 9 strikes/i })).toBeTruthy();
  });

  it("renders education content next to the title when supplied", () => {
    render(<GEXProfileChart data={[row(24000, 5, -1)]} spotPrice={24000} education={<span data-testid="edu">edu</span>} />);

    expect(screen.getByTestId("edu")).toBeTruthy();
  });
});
