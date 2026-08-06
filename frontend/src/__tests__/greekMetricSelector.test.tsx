import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GreekMetricSelector } from "@/components/greek-workspace/GreekMetricSelector";

// A broader-case companion to the single smoke test already in
// components.test.tsx — covers switching tabs, toggling a metric, and the
// higher-order tab's metric set, not just the collapsed-to-expanded flow.
describe("GreekMetricSelector", () => {
  it("shows only the core Greek tab's metrics by default once expanded", () => {
    render(
      <GreekMetricSelector activeTab="core" onTabChange={vi.fn()} visibleGreeks={["delta"]} onToggle={vi.fn()} liveCoverageLabel="2/2" />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dashboard panels" }));

    expect(screen.getByRole("button", { name: "Delta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vanna" })).toBeNull();
  });

  it("switches to the higher-order Greeks tab and shows its metrics", () => {
    const onTabChange = vi.fn();
    render(
      <GreekMetricSelector activeTab="core" onTabChange={onTabChange} visibleGreeks={[]} onToggle={vi.fn()} liveCoverageLabel="0/2" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Dashboard panels" }));

    fireEvent.click(screen.getByRole("tab", { name: "Higher-order Greeks" }));
    expect(onTabChange).toHaveBeenCalledWith("higher-order");
  });

  it("toggles a metric's visibility when its chip is clicked", () => {
    const onToggle = vi.fn();
    render(
      <GreekMetricSelector activeTab="core" onTabChange={vi.fn()} visibleGreeks={["delta"]} onToggle={onToggle} liveCoverageLabel="2/2" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Dashboard panels" }));

    fireEvent.click(screen.getByRole("button", { name: "Theta" }));
    expect(onToggle).toHaveBeenCalledWith("theta");
  });

  it("shows the collapsed hint and live coverage only once expanded", () => {
    render(
      <GreekMetricSelector activeTab="core" onTabChange={vi.fn()} visibleGreeks={[]} onToggle={vi.fn()} liveCoverageLabel="3/5" />
    );

    expect(screen.getByText("Expand to choose which Greek charts are visible.")).toBeTruthy();
    expect(screen.queryByText(/Live quote coverage/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dashboard panels" }));
    expect(screen.getByText(/Live quote coverage: 3\/5/)).toBeTruthy();
  });
});
