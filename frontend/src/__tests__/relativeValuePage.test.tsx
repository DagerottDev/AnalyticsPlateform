import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { getRelativeValueComparison } = vi.hoisted(() => ({ getRelativeValueComparison: vi.fn() }));
vi.mock("@/lib/relativeValue", () => ({ getRelativeValueComparison }));

const { useWatchlistStore } = vi.hoisted(() => {
  const state = {
    tickers: ["NIFTY", "BANKNIFTY"],
    addTicker: vi.fn(),
    removeTicker: vi.fn(),
  };
  return {
    useWatchlistStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});
vi.mock("@/stores/tickerStore", () => ({ useWatchlistStore }));

import RelativeValuePage from "@/app/relative-value/page";

describe("Relative Value page", () => {
  beforeEach(() => {
    getRelativeValueComparison.mockReset();
    getRelativeValueComparison.mockResolvedValue({
      generated_at: "2026-08-04T10:00:00Z",
      comparisons: [
        { symbol: "NIFTY", expiry: "2026-08-06", atm_iv: 0.18, skew: 0.02, net_gex: 1_500_000 },
        { symbol: "BANKNIFTY", expiry: "2026-08-06", atm_iv: 0.2, skew: 0.03, net_gex: 2_000_000 },
      ],
    });
  });

  it("shows and hides the Relative Value education layer", async () => {
    render(<RelativeValuePage />);
    await waitFor(() => expect(screen.getAllByText("Expiry 2026-08-06")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Show education" }));
    expect(screen.getByRole("complementary", { name: "Relative Value education" })).toBeTruthy();
    expect(screen.getByText("How to use Relative Value")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide Relative Value education" }));
    expect(screen.queryByRole("complementary", { name: "Relative Value education" })).toBeNull();
  });
});
