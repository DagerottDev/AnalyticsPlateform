import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "@/components/greek-workspace/WorkspaceHeader";

function baseProps() {
  return {
    symbol: "NIFTY",
    expiry: "27-Aug-2026",
    selectedCount: 2,
    loading: false,
    educationOpen: true,
    layoutMessage: "",
    onShowEducation: vi.fn(),
    onSave: vi.fn(),
    onRefresh: vi.fn(),
    onCreateAlert: vi.fn(),
    onOpenMarketStructure: vi.fn(),
    timeframe: "5",
    onTimeframeChange: vi.fn(),
  };
}

// A broader-case companion to the single smoke test already in
// components.test.tsx (which only checks the timeframe select) — covers
// every action button's callback wiring and the header's conditional UI.
describe("WorkspaceHeader", () => {
  it("wires every primary action button to its handler", () => {
    const props = baseProps();
    render(<WorkspaceHeader {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /Save layout/i }));
    expect(props.onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Market structure/i }));
    expect(props.onOpenMarketStructure).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Create alert/i }));
    expect(props.onCreateAlert).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Refresh 5m/i }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("hides the Show education button while education is already open, and shows it otherwise", () => {
    const props = baseProps();
    const { rerender } = render(<WorkspaceHeader {...props} educationOpen />);
    expect(screen.queryByRole("button", { name: /Show education/i })).toBeNull();

    rerender(<WorkspaceHeader {...props} educationOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Show education/i }));
    expect(props.onShowEducation).toHaveBeenCalledTimes(1);
  });

  it("disables the refresh button while loading and Market structure without symbol/expiry", () => {
    const props = baseProps();
    const { rerender } = render(<WorkspaceHeader {...props} loading />);
    expect((screen.getByRole("button", { name: /Refresh 5m/i }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<WorkspaceHeader {...props} symbol="" />);
    expect((screen.getByRole("button", { name: /Market structure/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Create alert and shows the reason as a tooltip when alerts are disabled", () => {
    const props = baseProps();
    render(<WorkspaceHeader {...props} alertsDisabled alertDisabledReason="Live trading required" />);

    const button = screen.getByRole("button", { name: /Create alert/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Live trading required");
  });

  it("toggles chart sync and shows the synced label", () => {
    const props = baseProps();
    const onToggleSyncCharts = vi.fn();
    const { rerender } = render(<WorkspaceHeader {...props} syncCharts={false} onToggleSyncCharts={onToggleSyncCharts} />);

    fireEvent.click(screen.getByRole("button", { name: /Sync charts/i }));
    expect(onToggleSyncCharts).toHaveBeenCalledTimes(1);

    rerender(<WorkspaceHeader {...props} syncCharts onToggleSyncCharts={onToggleSyncCharts} />);
    expect(screen.getByRole("button", { name: /Charts synced/i })).toBeTruthy();
  });

  it("shows the layout status message and a replay-session badge when applicable", () => {
    const props = baseProps();
    render(<WorkspaceHeader {...props} layoutMessage="Layout saved." replayActive replaySessionDate="2026-08-01" />);

    expect(screen.getByRole("status").textContent).toBe("Layout saved.");
    expect(screen.getByText(/Replay feed/)).toBeTruthy();
    expect(screen.getByText(/2026-08-01/)).toBeTruthy();
  });
});
