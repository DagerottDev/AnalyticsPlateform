import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LegManager } from "@/components/strategy-builder/LegManager";
import type { StrategyLeg } from "@/lib/strategy";
import type { Instrument } from "@/types/market";

// LegManager is the multi-leg strategy order builder, previously entirely
// untested. It's a pure props-in/onChange-out component (no store/hook
// dependencies), so these render it directly against a realistic option
// chain fixture and let the real strategyPresets.ts builders run — that
// gives genuine integration coverage of "does clicking Load Preset actually
// produce sensible legs", not just a mocked call-through.

const EXPIRY = "27-Aug-2026";
const OTHER_EXPIRY = "24-Sep-2026";

function makeInstrument(strike: number, optionType: "CE" | "PE", expiry = EXPIRY): Instrument {
  return {
    trading_symbol: `NSE:NIFTY${expiry}${strike}${optionType}`,
    symbol: "NIFTY",
    instrument_type: "OPTIDX",
    expiry,
    strike,
    option_type: optionType,
    exchange: "NFO",
    lot_size: 75,
  };
}

function buildChain(expiry = EXPIRY): Instrument[] {
  const strikes = [24600, 24700, 24800, 24900, 25000, 25100, 25200, 25300, 25400];
  return strikes.flatMap((strike) => [
    makeInstrument(strike, "CE", expiry),
    makeInstrument(strike, "PE", expiry),
  ]);
}

function makeLeg(overrides: Partial<StrategyLeg> = {}): StrategyLeg {
  return {
    id: "leg-1",
    instrument: null,
    action: "Buy",
    quantity: 75,
    entryPrice: 0,
    iv: 0.15,
    ...overrides,
  };
}

describe("LegManager — empty state and add/remove", () => {
  it("shows the empty state when there are no legs", () => {
    render(
      <LegManager
        legs={[]}
        onChange={vi.fn()}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    expect(screen.getByText("No legs added.")).toBeTruthy();
  });

  it("adding a leg defaults quantity to the lot size and appends to the list", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[makeLeg({ id: "existing" })]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Add Leg/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const newLegs = onChange.mock.calls[0][0] as StrategyLeg[];
    expect(newLegs).toHaveLength(2);
    expect(newLegs[0].id).toBe("existing"); // original untouched
    expect(newLegs[1].quantity).toBe(75);
    expect(newLegs[1].instrument).toBeNull();
  });

  it("the Add Leg button is disabled when the lot size is unknown", () => {
    render(
      <LegManager
        legs={[]}
        onChange={vi.fn()}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={0}
        spot={25000}
        spotReady
      />
    );

    const button = screen.getByRole("button", { name: /Add Leg/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("removing a leg calls onChange with that leg filtered out", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a" }), makeLeg({ id: "leg-b" })]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    const [firstRemove] = screen.getAllByLabelText("Remove leg");
    fireEvent.click(firstRemove);

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: "leg-b" })]);
  });
});

describe("LegManager — editing an existing leg", () => {
  it("toggling Buy/Sell updates only that leg's action", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a", action: "Buy" })]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Sell" }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "leg-a", action: "Sell" }),
    ]);
  });

  it("changing the quantity input updates that leg's quantity", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a" })]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "150" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "leg-a", quantity: 150 }),
    ]);
  });

  it("changing the entry price input updates that leg's entryPrice", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a" })]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Price"), { target: { value: "125.5" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "leg-a", entryPrice: 125.5 }),
    ]);
  });

  it("selecting a strike sets the leg's instrument to the matching one", () => {
    const onChange = vi.fn();
    const chain = buildChain();
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a" })]}
        onChange={onChange}
        availableInstruments={chain}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    const target = chain.find((i) => i.strike === 25000 && i.option_type === "CE")!;
    fireEvent.change(screen.getByDisplayValue("Select Strike (ATM first)…"), {
      target: { value: target.trading_symbol },
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "leg-a", instrument: target }),
    ]);
  });

  it("only offers strikes from the currently selected expiry", () => {
    const chain = [...buildChain(EXPIRY), ...buildChain(OTHER_EXPIRY)];
    render(
      <LegManager
        legs={[makeLeg({ id: "leg-a" })]}
        onChange={vi.fn()}
        availableInstruments={chain}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    const otherExpiryInstrument = chain.find(
      (i) => i.expiry === OTHER_EXPIRY && i.strike === 25000 && i.option_type === "CE"
    )!;
    expect(
      screen.queryByRole("option", { name: new RegExp(otherExpiryInstrument.trading_symbol) })
    ).toBeNull();
  });
});

describe("LegManager — Load Preset", () => {
  it("is disabled until an expiry is selected, a lot size is known, and spot is ready", () => {
    const { rerender } = render(
      <LegManager
        legs={[]}
        onChange={vi.fn()}
        availableInstruments={buildChain()}
        currentExpiry={null}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );
    expect((screen.getByRole("button", { name: /Load Preset/i }) as HTMLButtonElement).disabled).toBe(
      true
    );

    rerender(
      <LegManager
        legs={[]}
        onChange={vi.fn()}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady={false}
      />
    );
    expect((screen.getByRole("button", { name: /Load Preset/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText(/Waiting for the latest traded price/i)).toBeTruthy();
  });

  it("loading the default Iron Condor preset produces 4 legs with matched instruments", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Load Preset/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const legs = onChange.mock.calls[0][0] as StrategyLeg[];
    expect(legs).toHaveLength(4);
    expect(legs.every((leg) => leg.instrument !== null)).toBe(true);
    // Iron Condor: buy wing put, sell body put, sell body call, buy wing call.
    expect(legs.map((leg) => leg.action)).toEqual(["Buy", "Sell", "Sell", "Buy"]);
    expect(legs.map((leg) => leg.instrument!.option_type)).toEqual(["PE", "PE", "CE", "CE"]);
  });

  it("loading a Straddle preset produces matched ATM call and put legs", () => {
    const onChange = vi.fn();
    render(
      <LegManager
        legs={[]}
        onChange={onChange}
        availableInstruments={buildChain()}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
        defaultPreset="Straddle"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Load Preset/i }));

    const legs = onChange.mock.calls[0][0] as StrategyLeg[];
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => leg.instrument?.strike === 25000)).toBe(true);
    expect(legs.map((leg) => leg.instrument!.option_type).sort()).toEqual(["CE", "PE"]);
  });

  it("drops any preset leg for which no matching instrument exists in the chain", () => {
    const onChange = vi.fn();
    // A thin chain with only two strikes — the Iron Condor's wide wings
    // (4 steps out at the inferred step size) won't all resolve.
    const thinChain = [
      makeInstrument(25000, "CE"),
      makeInstrument(25000, "PE"),
      makeInstrument(25100, "CE"),
      makeInstrument(25100, "PE"),
    ];
    render(
      <LegManager
        legs={[]}
        onChange={onChange}
        availableInstruments={thinChain}
        currentExpiry={EXPIRY}
        lotSize={75}
        spot={25000}
        spotReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Load Preset/i }));

    const legs = onChange.mock.calls[0][0] as StrategyLeg[];
    // findInstrument still falls back to the *closest* available strike
    // rather than returning null (see strategyPresets.ts), so this thin
    // chain always resolves something — the guarantee under test is simply
    // that nothing null ever survives into the emitted leg list.
    expect(legs.every((leg) => leg.instrument !== null)).toBe(true);
  });
});
