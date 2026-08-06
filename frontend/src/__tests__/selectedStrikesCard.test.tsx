import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectedStrikesCard } from "@/components/greek-workspace/SelectedStrikesCard";
import type { Instrument } from "@/types/market";
import type { ResolvedOptionSelection } from "@/lib/analysisSelections";

function makeInstrument(strike: number | null, optionType: "CE" | "PE" | null): Instrument {
  return {
    trading_symbol: `NSE:NIFTY27AUG2026${strike ?? "X"}${optionType ?? "OPT"}`,
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry: "27-Aug-2026",
    strike,
    option_type: optionType,
    exchange: "NFO",
  };
}

// A broader-case companion to the single smoke test already in
// components.test.tsx — covers rolling selections, a null strike, and the
// zero-selection state, not just the two-fixed-instrument happy path.
describe("SelectedStrikesCard", () => {
  it("shows a zero count and an empty list when nothing is selected", () => {
    render(<SelectedStrikesCard instruments={[]} expiry="27-Aug-2026" />);

    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(screen.getByRole("list").children).toHaveLength(0);
  });

  it("counts fixed instruments and rolling selections together", () => {
    render(
      <SelectedStrikesCard
        instruments={[makeInstrument(25000, "CE")]}
        expiry="27-Aug-2026"
        rollingSelections={[{ label: "ATM CE", resolution: null }]}
      />
    );

    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "ATM CE rolling selection" })).toBeTruthy();
    expect(screen.getByText("Unavailable at current spot")).toBeTruthy();
  });

  it("shows the resolved strike for a rolling selection once it has a resolution", () => {
    const instrument = makeInstrument(24900, "PE");
    const resolution: ResolvedOptionSelection = {
      components: [{ instrument, weight: 1 }],
      effectiveStrike: 24900,
      optionType: "PE",
      mode: "raw",
    };
    render(
      <SelectedStrikesCard
        instruments={[]}
        expiry="27-Aug-2026"
        rollingSelections={[{ label: "OTM 1 PE", resolution }]}
      />
    );

    expect(screen.getByText(/Now/)).toBeTruthy();
  });

  it("falls back to a placeholder label when an instrument's strike is null", () => {
    render(<SelectedStrikesCard instruments={[makeInstrument(null, null)]} expiry="" />);

    expect(screen.getByText("Strike unavailable")).toBeTruthy();
  });
});
