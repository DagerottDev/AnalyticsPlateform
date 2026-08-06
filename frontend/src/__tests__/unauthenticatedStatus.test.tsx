import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const authState = {
  user: null,
  isAuthenticated: false,
  logout: vi.fn(),
  isPaperMode: true,
  brokerName: "Not authenticated",
  sessionLive: true,
  token: null,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/stores/alertStore", () => ({
  useAlertStore: (selector: (state: { triggerLog: never[]; clearTriggerLog: () => void }) => unknown) =>
    selector({ triggerLog: [], clearTriggerLog: vi.fn() }),
}));

import { Header } from "@/components/layout/Header";

describe("unauthenticated market status", () => {
  it("labels the header as not authenticated", () => {
    render(<Header />);

    expect(screen.getAllByText("Not authenticated")).toHaveLength(2);
  });
});
