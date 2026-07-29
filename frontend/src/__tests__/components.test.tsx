import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/dashboard" }));
vi.mock("@/lib/market", () => ({ getInstruments: vi.fn().mockResolvedValue({ instruments: [] }) }));
vi.mock("@/hooks/useMarketData", () => ({ useMarketData: () => ({ getTick: () => null }) }));

import { Sidebar } from "@/components/layout/Sidebar";
import { LegManager } from "@/components/strategy-builder/LegManager";
import { PayoffChart } from "@/components/strategy-builder/PayoffChart";
import { OptionChain } from "@/components/market/OptionChain";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { Tabs } from "@/components/ui/Tabs";

describe("core UI components", () => {
  it("navigates and collapses the sidebar", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Charts" }));
    expect(push).toHaveBeenCalledWith("/charts");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("adds and updates strategy legs", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LegManager legs={[]} onChange={onChange} availableInstruments={[]} currentExpiry="2026-08-27" lotSize={50} spot={22000} />);
    fireEvent.click(screen.getByRole("button", { name: /add leg/i }));
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(1);
    rerender(<LegManager legs={added} onChange={onChange} availableInstruments={[]} currentExpiry="2026-08-27" lotSize={50} spot={22000} />);
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(onChange.mock.calls.at(-1)?.[0][0].action).toBe("Sell");
  });

  it("shows a useful payoff empty state", () => {
    render(<PayoffChart data={[]} currentSpot={22000} />);
    expect(screen.getByText("Add strategy legs to view payoff profile.")).toBeTruthy();
  });

  it("renders the option-chain empty state after a successful fetch", async () => {
    render(<OptionChain symbol="NIFTY" expiry="2026-08-27" />);
    await waitFor(() => expect(screen.getByText("No contracts found for selected expiry.")).toBeTruthy());
  });

  it("offers chart values through a keyboard-operable data table", () => {
    render(
      <ChartDataTable
        title="Price history"
        summary="Two price observations."
        columns={[{ key: "time", label: "Time" }, { key: "price", label: "Price" }]}
        rows={[{ time: "09:15", price: "100.00" }, { time: "09:16", price: "101.50" }]}
      />
    );

    const summary = screen.getByText("View Price history data table");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);
    fireEvent.keyDown(summary, { key: "Enter" });
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeTruthy();
    expect(screen.getByText("101.50")).toBeTruthy();
  });

  it("moves between tabs with arrow keys", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ id: "one", label: "One" }, { id: "two", label: "Two" }]} value="one" onChange={onChange} />);

    const one = screen.getByRole("tab", { name: "One" });
    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("two");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Two" }));
  });
});
