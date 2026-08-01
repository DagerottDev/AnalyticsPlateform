import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/dashboard" }));
vi.mock("@/lib/market", () => ({
  getInstruments: vi.fn().mockResolvedValue({ instruments: [] }),
  getMarketQuotes: vi.fn().mockResolvedValue({ quotes: [] }),
}));
vi.mock("@/hooks/useMarketData", () => ({ useMarketData: () => ({ getTick: () => null }) }));

import { Sidebar } from "@/components/layout/Sidebar";
import { LegManager } from "@/components/strategy-builder/LegManager";
import { PayoffChart } from "@/components/strategy-builder/PayoffChart";
import { OptionChain } from "@/components/market/OptionChain";
import { toClosedMarketQuote } from "@/components/market/OptionChain";
import { ChartDataTable } from "@/components/charts/ChartDataTable";
import { Tabs } from "@/components/ui/Tabs";
import { SelectedStrikesCard } from "@/components/greek-workspace/SelectedStrikesCard";
import { WorkspaceHeader } from "@/components/greek-workspace/WorkspaceHeader";

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

  it("uses the broker previous close for a closed-market option snapshot", () => {
    const quote = toClosedMarketQuote({
      trading_symbol: "NSE:NIFTY26JUL23000CE",
      last_price: 999,
      prev_close_price: 125.5,
      volume: 0,
      open_interest: 0,
      timestamp: Date.now(),
      change: 14,
      change_percent: 1.4,
    });

    expect(quote.last_price).toBe(125.5);
    expect(quote.change).toBe(0);
    expect(quote.change_percent).toBe(0);
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

  it("shows every selected option strike in the Greek workspace card", () => {
    render(
      <SelectedStrikesCard
        expiry="2026-08-27"
        instruments={[
          { trading_symbol: "NFO:NIFTY26AUG22000CE", symbol: "NIFTY", instrument_type: "OPTIDX", expiry: "2026-08-27", strike: 22000, option_type: "CE", exchange: "NFO" },
          { trading_symbol: "NFO:NIFTY26AUG22100PE", symbol: "NIFTY", instrument_type: "OPTIDX", expiry: "2026-08-27", strike: 22100, option_type: "PE", exchange: "NFO" },
        ]}
      />
    );

    expect(screen.getByRole("region", { name: "Selected strikes" })).toBeTruthy();
    expect(screen.getByText("22,000")).toBeTruthy();
    expect(screen.getByText("22,100")).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("allows the Greek workspace timeframe to be changed through the header", () => {
    const onTimeframeChange = vi.fn();
    render(
      <WorkspaceHeader
        symbol="NIFTY"
        expiry="2026-08-27"
        selectedCount={2}
        loading={false}
        educationOpen
        layoutMessage=""
        onShowEducation={vi.fn()}
        onSave={vi.fn()}
        onRefresh={vi.fn()}
        onCreateAlert={vi.fn()}
        timeframe="5"
        onTimeframeChange={onTimeframeChange}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Greek workspace timeframe" }), { target: { value: "15" } });
    expect(onTimeframeChange).toHaveBeenCalledWith("15");
  });
});
