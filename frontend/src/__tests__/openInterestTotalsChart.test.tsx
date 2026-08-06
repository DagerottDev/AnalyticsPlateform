import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenInterestTotalsChart } from "@/components/open-interest/OpenInterestTotalsChart";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

// A broader-case companion to the single smoke test already in
// components.test.tsx — covers the "only one side has OI" boundary and the
// data-table row contents, not just the fully-populated and fully-empty cases.
describe("OpenInterestTotalsChart", () => {
  it("shows an empty state only when both call and put OI are non-positive", () => {
    render(<OpenInterestTotalsChart totalCallOi={0} totalPutOi={0} totalCallChange={0} totalPutChange={0} />);
    expect(screen.getByText("No aggregate call or put OI is available for this expiry.")).toBeTruthy();
  });

  it("renders when only one side has any open interest", () => {
    render(<OpenInterestTotalsChart totalCallOi={500} totalPutOi={0} totalCallChange={0} totalPutChange={0} />);

    expect(screen.getByText("Call vs Put Open Interest")).toBeTruthy();
    expect(screen.getByRole("img", { name: /calls 500, puts 0/i })).toBeTruthy();
  });

  it("exposes the same totals in the accessible data table", () => {
    render(<OpenInterestTotalsChart totalCallOi={1250} totalPutOi={1800} totalCallChange={-45} totalPutChange={70} />);

    expect(screen.getByText("View call versus put open interest data table")).toBeTruthy();
    // Table rows carry the raw locale-formatted totals independently of the chart SVG.
    expect(screen.getByRole("cell", { name: "1,250" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1,800" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "-45" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "70" })).toBeTruthy();
  });
});
