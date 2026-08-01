import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ tradingMode: "paper" as "paper" | "live" }));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/positions/BrokerAccountPanel", () => ({
  BrokerAccountPanel: () => <div data-testid="broker-account-panel">Live broker content</div>,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/hooks/useMarketData", () => ({
  useMarketData: () => ({ getTick: () => null }),
}));
vi.mock("@/stores/positionStore", () => ({
  usePositionStore: () => ({
    positions: [],
    closePosition: vi.fn(),
    removePosition: vi.fn(),
    clearClosed: vi.fn(),
  }),
}));

import PositionsPage from "@/app/positions/page";

describe("positions trading-mode layout", () => {
  beforeEach(() => {
    authState.tradingMode = "paper";
  });

  it("shows only the paper portfolio in paper mode", () => {
    render(<PositionsPage />);

    expect(screen.getByText("Open Paper Positions")).toBeTruthy();
    expect(screen.queryByTestId("broker-account-panel")).toBeNull();
    expect(screen.queryByText("Live Broker Account")).toBeNull();
  });

  it("shows the live broker account above the paper portfolio in live mode", () => {
    authState.tradingMode = "live";
    render(<PositionsPage />);

    expect(screen.getByTestId("broker-account-panel")).toBeTruthy();
    expect(screen.getByText("Live Broker Account")).toBeTruthy();
    expect(screen.getByText("Paper Positions")).toBeTruthy();

    const liveHeading = screen.getByText("Live Broker Account");
    const paperHeading = screen.getByText("Paper Positions");
    expect(liveHeading.compareDocumentPosition(paperHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
