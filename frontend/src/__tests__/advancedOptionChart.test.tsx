import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  getInstruments: vi.fn(),
  getHistoricalCandles: vi.fn(),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/market/InstrumentSelector", () => ({
  InstrumentSelector: ({ onExpiryChange }: { onExpiryChange: (expiry: string) => void }) => (
    <button type="button" onClick={() => onExpiryChange("28-Aug-2026")}>Select test expiry</button>
  ),
}));
vi.mock("@/components/charts/TradingChart", () => ({
  TradingChart: ({ symbol }: { symbol?: string }) => <div data-testid="trading-chart">{symbol}</div>,
}));
vi.mock("@/components/charts/Heatmap", () => ({ Heatmap: () => null }));
vi.mock("@/components/market/DataFreshness", () => ({ DataFreshness: () => null }));
vi.mock("@/hooks/useMarketData", () => ({ useMarketData: () => ({ getTick: () => null }) }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ defaultSymbol: "NIFTY" }) },
}));
vi.mock("@/lib/market", () => market);

import ChartsPage from "@/app/charts/page";

describe("advanced option chart", () => {
  it("requests historical candles for the exact selected option contract", async () => {
    market.getHistoricalCandles.mockResolvedValue([
      { timestamp: "2026-08-20T09:15:00Z", open: 100, high: 102, low: 99, close: 101, volume: 50, open_interest: 0 },
    ]);
    market.getInstruments.mockResolvedValue({
      instruments: [
        {
          trading_symbol: "NSE:NIFTY2682822500CE",
          symbol: "NIFTY",
          instrument_type: "OPTIDX",
          expiry: "28-Aug-2026",
          strike: 22500,
          option_type: "CE",
          exchange: "NSE",
        },
        {
          trading_symbol: "NSE:NIFTY2682822500PE",
          symbol: "NIFTY",
          instrument_type: "OPTIDX",
          expiry: "28-Aug-2026",
          strike: 22500,
          option_type: "PE",
          exchange: "NSE",
        },
      ],
    });

    render(<ChartsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Select test expiry" }));

    await waitFor(() => expect(screen.getByRole("option", { name: "22,500" })).toBeTruthy());
    await waitFor(() => expect((screen.getByLabelText("Strike price") as HTMLSelectElement).value).toBe("22500"));

    await waitFor(() => expect(market.getHistoricalCandles).toHaveBeenCalledWith(
      "NSE:NIFTY2682822500CE",
      expect.any(String),
      expect.any(String),
      "1"
    ));
    expect(screen.getByTestId("trading-chart").textContent).toContain("22500 CE");
  });
});
