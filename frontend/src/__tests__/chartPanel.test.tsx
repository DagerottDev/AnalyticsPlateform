import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChartPanel } from "@/components/charts/ChartPanel";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

function baseProps() {
  return {
    isEmpty: false,
    emptyTitle: "No data available.",
    height: "h-[300px]",
    title: "Test Chart",
    zoomLabel: "test chart",
    ariaLabel: "Test chart across 2 strikes.",
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    tableTitle: "test chart",
    tableSummary: "2 rows.",
    tableColumns: [{ key: "strike", label: "Strike" }],
    tableRows: [{ strike: 100 }, { strike: 200 }],
  };
}

// ChartPanel is the shared scaffold extracted out of ExposureChart,
// GEXProfileChart, TermStructureChart, and IVSmileChart — those files'
// own tests cover their specific axes/series; this covers the shared
// empty-state/header/data-table wiring in isolation.
describe("ChartPanel", () => {
  it("renders only the empty state when isEmpty is true", () => {
    render(
      <ChartPanel {...baseProps()} isEmpty emptyTitle="No data available for X.">
        <div data-testid="chart-child" />
      </ChartPanel>
    );

    expect(screen.getByText("No data available for X.")).toBeTruthy();
    expect(screen.queryByText("Test Chart")).toBeNull();
    expect(screen.queryByTestId("chart-child")).toBeNull();
  });

  it("renders the title, aria-labelled chart region, children, and the data table when not empty", () => {
    render(
      <ChartPanel {...baseProps()}>
        <div data-testid="chart-child" />
      </ChartPanel>
    );

    expect(screen.getByText("Test Chart")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Test chart across 2 strikes." })).toBeTruthy();
    expect(screen.getByTestId("chart-child")).toBeTruthy();
    expect(screen.getByText("View test chart data table")).toBeTruthy();
  });

  it("wires the zoom controls to the supplied callbacks", () => {
    const props = baseProps();
    render(
      <ChartPanel {...props}>
        <div />
      </ChartPanel>
    );

    fireEvent.click(screen.getByRole("button", { name: "Zoom in test chart" }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Zoom out test chart" }));
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reset test chart zoom" }));
    expect(props.onZoomReset).toHaveBeenCalledTimes(1);
  });
});
