import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TermStructureChart } from "@/components/volatility/TermStructureChart";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

describe("TermStructureChart", () => {
  it("shows an empty state when there is no positive ATM IV data", () => {
    render(<TermStructureChart data={[{ expiry: "27-Aug-2026", atmIV: 0 }]} />);

    expect(screen.getByText("No ATM IV data available for term structure.")).toBeTruthy();
  });

  it("renders the chart and its data table for valid expiries", () => {
    render(
      <TermStructureChart
        data={[
          { expiry: "27-Aug-2026", atmIV: 0.145 },
          { expiry: "24-Sep-2026", atmIV: 0.16 },
        ]}
      />
    );

    expect(screen.getByText("Volatility Term Structure")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Volatility term structure line chart across 2 expiries/i })
    ).toBeTruthy();
    expect(screen.getByText("View volatility term structure data table")).toBeTruthy();
  });
});
