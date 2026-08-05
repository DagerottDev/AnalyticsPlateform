import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
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
import { GreekMetricSelector } from "@/components/greek-workspace/GreekMetricSelector";
import { OpenInterestTotalsChart } from "@/components/open-interest/OpenInterestTotalsChart";
import { OpenInterestTimeSeriesChart } from "@/components/open-interest/OpenInterestTimeSeriesChart";
import { NumericParameterInput } from "@/components/charts/NumericParameterInput";

describe("core UI components", () => {
  it("navigates and collapses the sidebar", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Charts" }));
    expect(push).toHaveBeenCalledWith("/charts");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("can start the sidebar collapsed for chart workspaces", () => {
    render(<Sidebar initialCollapsed />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("adds and updates strategy legs", () => {
    const onChange = vi.fn();
    const { rerender } = render(<LegManager legs={[]} onChange={onChange} availableInstruments={[]} currentExpiry="2026-08-27" lotSize={50} spot={22000} spotReady />);
    fireEvent.click(screen.getByRole("button", { name: /add leg/i }));
    const added = onChange.mock.calls[0][0];
    expect(added).toHaveLength(1);
    rerender(<LegManager legs={added} onChange={onChange} availableInstruments={[]} currentExpiry="2026-08-27" lotSize={50} spot={22000} spotReady />);
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(onChange.mock.calls.at(-1)?.[0][0].action).toBe("Sell");
  });

  it("shows a useful payoff empty state", () => {
    render(<PayoffChart data={[]} currentSpot={22000} />);
    expect(screen.getByText("Add strategy legs to view payoff profile.")).toBeTruthy();
  });

  it("allows a Supertrend multiplier to be cleared while editing and commits an integer", () => {
    const onValueChange = vi.fn();
    render(
      <NumericParameterInput
        ariaLabel="Supertrend multiplier"
        value={3}
        min={1}
        max={10}
        step={1}
        integer
        onValueChange={onValueChange}
      />
    );

    const input = screen.getByRole("spinbutton", { name: "Supertrend multiplier" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onValueChange).toHaveBeenLastCalledWith(5);
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith(3);
  });

  it("zooms the payoff profile around spot and can reset the view", () => {
    render(
      <PayoffChart
        currentSpot={22000}
        data={[
          { strike: 21000, profitAtExpiry: -100, profitT0: -80 },
          { strike: 21500, profitAtExpiry: -50, profitT0: -40 },
          { strike: 22000, profitAtExpiry: 0, profitT0: 0 },
          { strike: 22500, profitAtExpiry: 50, profitT0: 40 },
          { strike: 23000, profitAtExpiry: 100, profitT0: 80 },
        ]}
      />
    );

    expect(screen.getByText("Full range")).toBeTruthy();
    const zoomOut = screen.getByRole("button", { name: "Zoom out payoff profile" }) as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in payoff profile" }));
    expect(screen.getByText("Zoom: 1.6×")).toBeTruthy();
    expect(zoomOut.disabled).toBe(false);

    fireEvent.contextMenu(screen.getByRole("img", { name: /strategy payoff profile/i }));
    expect(screen.getByText("Full range")).toBeTruthy();
    expect(zoomOut.disabled).toBe(true);
  });

  it("renders the option-chain empty state after a successful fetch", async () => {
    render(<OptionChain symbol="NIFTY" expiry="2026-08-27" />);
    await waitFor(() => expect(screen.getByText("No contracts found for selected expiry.")).toBeTruthy());
  });

  it("keeps the broker last price for a closed-market option snapshot", () => {
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

    expect(quote.last_price).toBe(999);
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

  it("starts the Greek dashboard panel controls collapsed", () => {
    render(
      <GreekMetricSelector
        activeTab="core"
        onTabChange={vi.fn()}
        visibleGreeks={["delta"]}
        onToggle={vi.fn()}
        liveCoverageLabel="1/1"
      />
    );

    const toggle = screen.getByRole("button", { name: "Dashboard panels" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("tab", { name: "Core Greeks" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tab", { name: "Core Greeks" })).toBeTruthy();
  });

  it("shows aggregate call and put OI with its broker-baseline session change", () => {
    render(<OpenInterestTotalsChart totalCallOi={1250} totalPutOi={1800} totalCallChange={-45} totalPutChange={70} />);

    expect(screen.getByText("Call vs Put Open Interest")).toBeTruthy();
    expect(screen.getByText("Session OI Change")).toBeTruthy();
    expect(screen.getByText(/Broker change versus prior close/i)).toBeTruthy();
    expect(screen.getByRole("img", { name: /calls 1,250, puts 1,800/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /calls -45, puts 70/i })).toBeTruthy();
  });

  it("shows an empty state when neither side has aggregate OI", () => {
    render(<OpenInterestTotalsChart totalCallOi={0} totalPutOi={0} totalCallChange={0} totalPutChange={0} />);

    expect(screen.getByText("No aggregate call or put OI is available for this expiry.")).toBeTruthy();
  });

  it("shows a useful empty state before the first live OI snapshot", () => {
    render(<OpenInterestTimeSeriesChart points={[]} scheduledTracking={false} />);

    expect(screen.getByText("Live OI history will appear after the first option-chain snapshot.")).toBeTruthy();
  });
});
