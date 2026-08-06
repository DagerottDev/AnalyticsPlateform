import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
});

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { getIvUniverse } = vi.hoisted(() => ({ getIvUniverse: vi.fn() }));
vi.mock("@/lib/ivUniverse", () => ({
  getIvUniverse,
  expectedIvRange: (spot: number | null, atmIv: number | null, days: number, sigma: number) => {
    if (spot === null || atmIv === null) return null;
    const move = spot * atmIv * sigma * Math.sqrt(days / 365);
    return { move, lower: Math.max(0, spot - move), upper: spot + move };
  },
}));

import VolatilityScreenerPage from "@/app/volatility/screener/page";
import { useSettingsStore } from "@/stores/settingsStore";

const response = {
  generated_at: "2026-08-04T10:00:00Z",
  corporate_calendar: { status: "ready" as const, updated_at: "2026-08-04T10:00:00Z" },
  symbols: [
    {
      symbol: "RELIANCE",
      company_name: "Reliance Industries",
      spot: 2900,
      atm_iv: 0.18,
      iv_rank: 42,
      iv_percentile: 55,
      snapshot_date: "2026-08-04",
      updated_at: "2026-08-04T09:59:00Z",
      status: "ready" as const,
      events: [
        {
          event_type: "results" as const,
          title: "Financial Results",
          event_date: "2026-08-08",
          date_kind: "meeting_date" as const,
          source: "NSE" as const,
        },
        {
          event_type: "dividend" as const,
          title: "Dividend - Rs 10 Per Share",
          event_date: "2026-08-10",
          date_kind: "ex_date" as const,
          source: "NSE" as const,
        },
      ],
    },
    {
      symbol: "TCS",
      company_name: "Tata Consultancy Services",
      spot: null,
      atm_iv: null,
      iv_rank: null,
      iv_percentile: null,
      snapshot_date: null,
      updated_at: null,
      status: "building" as const,
      events: [],
    },
  ],
};

describe("IV screener", () => {
  beforeEach(() => {
    getIvUniverse.mockReset();
    getIvUniverse.mockResolvedValue(response);
    useSettingsStore.getState().resetToDefaults();
  });

  it("renders status and keeps sorting keyboard accessible", async () => {
    render(<VolatilityScreenerPage />);

    await waitFor(() => expect(screen.getByText("RELIANCE")).toBeTruthy());
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Building")).toBeTruthy();

    const sortButton = screen.getByRole("button", { name: "Sort by Spot" });
    expect(sortButton).toBeTruthy();
    const spotHeader = sortButton.closest("th");
    expect(spotHeader?.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(sortButton);
    expect(spotHeader?.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(sortButton);
    expect(spotHeader?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("filters by symbol or company name", async () => {
    render(<VolatilityScreenerPage />);
    await waitFor(() => expect(screen.getByText("RELIANCE")).toBeTruthy());

    fireEvent.change(screen.getByRole("textbox", { name: "Search IV screener symbols" }), {
      target: { value: "tata" },
    });

    expect(screen.getByText("TCS")).toBeTruthy();
    expect(screen.queryByText("RELIANCE")).toBeNull();
  });

  it("shows and hides the IV education layer", async () => {
    render(<VolatilityScreenerPage />);
    await waitFor(() => expect(screen.getByText("RELIANCE")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Show education" }));
    expect(screen.getByRole("complementary", { name: "IV Screener education" })).toBeTruthy();
    expect(screen.getByText("How to use the IV Screener")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide IV Screener education" }));
    expect(screen.queryByRole("complementary", { name: "IV Screener education" })).toBeNull();
  });

  it("projects the selected IV range and shows announced event details", async () => {
    render(<VolatilityScreenerPage />);

    await waitFor(() => expect(screen.getByText("RELIANCE")).toBeTruthy());
    expect(screen.getByText("Results · 8 Aug")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    fireEvent.click(screen.getByText("Results · 8 Aug"));
    expect(screen.getByText("Dividend - Rs 10 Per Share")).toBeTruthy();
    expect(screen.getByText(/±₹/)).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "IV range confidence" }), {
      target: { value: "2" },
    });
    expect(useSettingsStore.getState().ivScreener.sigma).toBe(2);
  });

  it("refetches the event window when projection days change", async () => {
    render(<VolatilityScreenerPage />);
    await waitFor(() => expect(getIvUniverse).toHaveBeenCalledWith(14));

    fireEvent.click(screen.getByRole("button", { name: "30D" }));
    await waitFor(() => expect(getIvUniverse).toHaveBeenCalledWith(30));
    expect(useSettingsStore.getState().ivScreener.projectionDays).toBe(30);
  });

  it("does not imply an event-free window when the feed is unavailable", async () => {
    getIvUniverse.mockResolvedValue({
      ...response,
      corporate_calendar: { status: "unavailable" as const, updated_at: null },
    });
    render(<VolatilityScreenerPage />);

    await waitFor(() => expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0));
    expect(screen.getByText(/Event calendar is not fully available; ranges are not event-checked/)).toBeTruthy();
  });
});
