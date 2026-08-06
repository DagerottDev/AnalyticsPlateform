import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSummaryStrip } from "@/components/greek-workspace/WorkspaceSummaryStrip";

describe("WorkspaceSummaryStrip", () => {
  it("renders spot, DTE, ATM IV/price, and live coverage", () => {
    render(
      <WorkspaceSummaryStrip
        spot={25000}
        dte={12}
        atmIv={0.145}
        atmPrice={182.5}
        liveContracts={4}
        totalContracts={4}
        quoteQuality="mid"
      />
    );

    expect(screen.getByText("12d")).toBeTruthy();
    expect(screen.getByText("14.5%")).toBeTruthy();
    expect(screen.getByText("4/4")).toBeTruthy();
    expect(screen.getByText(/bid\/ask midpoint/i)).toBeTruthy();
  });

  it("shows placeholders when ATM IV/price are unavailable and describes the fallback quote quality", () => {
    render(
      <WorkspaceSummaryStrip
        spot={25000}
        dte={0}
        atmIv={null}
        atmPrice={null}
        liveContracts={0}
        totalContracts={4}
        quoteQuality="ltp"
      />
    );

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(2); // ATM IV and ATM theoretical price
    expect(screen.getByText(/last traded price fallback/i)).toBeTruthy();
  });

  it("describes the quote input as awaiting quotes when quality is unset", () => {
    render(
      <WorkspaceSummaryStrip spot={25000} dte={5} atmIv={0.1} atmPrice={100} liveContracts={1} totalContracts={2} />
    );

    expect(screen.getByText(/awaiting live option quotes/i)).toBeTruthy();
  });
});
