import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenInterestChangeChart } from "@/components/open-interest/OpenInterestChangeChart";
import type { OpenInterestStrike } from "@/lib/openInterestAnalysis";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

function strike(strike: number, callChange: number, putChange: number): OpenInterestStrike {
  return { strike, callOi: 0, putOi: 0, callChange, putChange };
}

describe("OpenInterestChangeChart", () => {
  it("shows an empty state when there is no strike data", () => {
    render(<OpenInterestChangeChart data={[]} />);

    expect(screen.getByText("No session OI-change data is available for this expiry.")).toBeTruthy();
  });

  it("renders the chart and its accessible data table for the supplied strikes", () => {
    const data = [strike(24000, 1200, -500), strike(24100, -300, 900)];
    render(<OpenInterestChangeChart data={data} />);

    expect(screen.getByText("Session OI Change")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Session open-interest change chart across 2 strikes/i })
    ).toBeTruthy();
    expect(screen.getByText("View session open interest change data table")).toBeTruthy();
  });
});
