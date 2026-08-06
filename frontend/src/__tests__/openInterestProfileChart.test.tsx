import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenInterestProfileChart } from "@/components/open-interest/OpenInterestProfileChart";
import type { OpenInterestLevel, OpenInterestStrike } from "@/lib/openInterestAnalysis";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

function strike(strike: number, callOi: number, putOi: number): OpenInterestStrike {
  return { strike, callOi, putOi, callChange: 0, putChange: 0 };
}

describe("OpenInterestProfileChart", () => {
  it("shows an empty state when there is no strike data", () => {
    render(<OpenInterestProfileChart data={[]} spot={24000} support={null} resistance={null} />);

    expect(screen.getByText("No open-interest data is available for this expiry.")).toBeTruthy();
  });

  it("labels support and resistance strikes as unavailable when neither level is known", () => {
    const data = [strike(23900, 1000, 800), strike(24000, 1500, 1200), strike(24100, 700, 2000)];
    render(<OpenInterestProfileChart data={data} spot={24000} support={null} resistance={null} />);

    expect(
      screen.getByRole("img", {
        name: /Open interest profile across 3 strikes\. Spot is 24000\.00\. Support is unavailable; resistance is unavailable\./i,
      })
    ).toBeTruthy();
  });

  it("reflects the resolved support and resistance strikes in the chart label", () => {
    const data = [strike(23900, 1000, 800), strike(24000, 1500, 1200), strike(24100, 700, 2000)];
    const support: OpenInterestLevel = { strike: 23900, openInterest: 800, sessionChange: 50 };
    const resistance: OpenInterestLevel = { strike: 24100, openInterest: 2000, sessionChange: -80 };
    render(<OpenInterestProfileChart data={data} spot={24000} support={support} resistance={resistance} />);

    expect(
      screen.getByRole("img", { name: /Support is 23900; resistance is 24100\./i })
    ).toBeTruthy();
    expect(screen.getByText("View open interest profile data table")).toBeTruthy();
  });
});
