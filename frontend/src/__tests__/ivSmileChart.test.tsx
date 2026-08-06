import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IVSmileChart } from "@/components/volatility/IVSmileChart";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

describe("IVSmileChart", () => {
  it("shows an empty state when neither call nor put IV is available at any strike", () => {
    render(<IVSmileChart data={[{ strike: 25000, ceIV: 0, peIV: 0 }]} />);

    expect(screen.getByText("No IV data available. Ensure the market is open and live ticks are flowing.")).toBeTruthy();
  });

  it("renders the chart and its data table, including a strike with only one side priced", () => {
    render(
      <IVSmileChart
        data={[
          { strike: 24900, ceIV: 0.15, peIV: 0.17 },
          { strike: 25000, ceIV: 0.14, peIV: 0 }, // put IV missing at this strike
        ]}
      />
    );

    expect(screen.getByText("Volatility Smile")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Volatility smile line chart across 2 strikes/i })
    ).toBeTruthy();
    expect(screen.getByText("View volatility smile data table")).toBeTruthy();
  });
});
