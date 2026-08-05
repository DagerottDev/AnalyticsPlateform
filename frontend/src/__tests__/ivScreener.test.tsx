import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { getIvUniverse } = vi.hoisted(() => ({ getIvUniverse: vi.fn() }));
vi.mock("@/lib/ivUniverse", () => ({ getIvUniverse }));

import VolatilityScreenerPage from "@/app/volatility/screener/page";

const response = {
  generated_at: "2026-08-04T10:00:00Z",
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
    },
  ],
};

describe("IV screener", () => {
  beforeEach(() => {
    getIvUniverse.mockReset();
    getIvUniverse.mockResolvedValue(response);
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
});
