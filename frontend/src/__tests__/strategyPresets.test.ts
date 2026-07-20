import { describe, it, expect } from "vitest";
import { Instrument } from "@/types/market";
import {
  buildIronCondorLegs,
  buildStraddleLegs,
  buildStrangleLegs,
  buildButterflyLegs,
  buildCalendarLegs,
  buildDiagonalLegs,
} from "../lib/strategyPresets";
import { calculatePayoffProfile, StrategyLeg } from "../lib/strategy";

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const NEAR_EXPIRY = daysFromNow(14);
const FAR_EXPIRY = daysFromNow(45);
const SPOT = 22000;
const LOT_SIZE = 50;

function makeChain(expiry: string): Instrument[] {
  const instruments: Instrument[] = [];
  for (let strike = 21000; strike <= 23000; strike += 50) {
    for (const option_type of ["CE", "PE"] as const) {
      instruments.push({
        trading_symbol: `NIFTY${expiry}${strike}${option_type}`,
        symbol: "NIFTY",
        instrument_type: "OPTIDX",
        expiry,
        strike,
        option_type,
        exchange: "NFO",
      });
    }
  }
  return instruments;
}

const chain = [...makeChain(NEAR_EXPIRY), ...makeChain(FAR_EXPIRY)];

describe("Strategy presets", () => {
  it("builds an Iron Condor with the correct strike ordering and Buy/Sell pattern", () => {
    const legs = buildIronCondorLegs(chain, NEAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(4);

    const [longPut, shortPut, shortCall, longCall] = legs;
    expect(longPut.instrument!.option_type).toBe("PE");
    expect(shortPut.instrument!.option_type).toBe("PE");
    expect(shortCall.instrument!.option_type).toBe("CE");
    expect(longCall.instrument!.option_type).toBe("CE");

    expect(longPut.action).toBe("Buy");
    expect(shortPut.action).toBe("Sell");
    expect(shortCall.action).toBe("Sell");
    expect(longCall.action).toBe("Buy");

    // Wings further from spot than the short strikes (the actual "condor" shape).
    expect(longPut.instrument!.strike!).toBeLessThan(shortPut.instrument!.strike!);
    expect(shortPut.instrument!.strike!).toBeLessThan(SPOT);
    expect(shortCall.instrument!.strike!).toBeGreaterThan(SPOT);
    expect(shortCall.instrument!.strike!).toBeLessThan(longCall.instrument!.strike!);
  });

  it("builds a Straddle at a single ATM strike", () => {
    const legs = buildStraddleLegs(chain, NEAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(2);
    const [call, put] = legs;
    expect(call.instrument!.option_type).toBe("CE");
    expect(put.instrument!.option_type).toBe("PE");
    expect(call.instrument!.strike).toBe(put.instrument!.strike);
    expect(call.action).toBe("Buy");
    expect(put.action).toBe("Buy");
  });

  it("builds a Strangle with Call above spot and Put below spot", () => {
    const legs = buildStrangleLegs(chain, NEAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(2);
    const [call, put] = legs;
    expect(call.instrument!.strike!).toBeGreaterThan(SPOT);
    expect(put.instrument!.strike!).toBeLessThan(SPOT);
  });

  it("builds a Butterfly with a doubled short middle strike", () => {
    const legs = buildButterflyLegs(chain, NEAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(3);
    const [lower, middle, upper] = legs;
    expect(lower.action).toBe("Buy");
    expect(middle.action).toBe("Sell");
    expect(upper.action).toBe("Buy");
    expect(middle.quantity).toBe(lower.quantity * 2);
    expect(lower.instrument!.strike!).toBeLessThan(middle.instrument!.strike!);
    expect(middle.instrument!.strike!).toBeLessThan(upper.instrument!.strike!);
  });

  it("builds a Calendar spread: same strike, two different expiries", () => {
    const legs = buildCalendarLegs(chain, NEAR_EXPIRY, FAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(2);
    const [near, far] = legs;
    expect(near.instrument!.expiry).toBe(NEAR_EXPIRY);
    expect(far.instrument!.expiry).toBe(FAR_EXPIRY);
    expect(near.instrument!.strike).toBe(far.instrument!.strike);
    expect(near.action).toBe("Sell");
    expect(far.action).toBe("Buy");
  });

  it("builds a Diagonal spread: different strikes AND different expiries", () => {
    const legs = buildDiagonalLegs(chain, NEAR_EXPIRY, FAR_EXPIRY, SPOT, LOT_SIZE);
    expect(legs).toHaveLength(2);
    const [near, far] = legs;
    expect(near.instrument!.expiry).toBe(NEAR_EXPIRY);
    expect(far.instrument!.expiry).toBe(FAR_EXPIRY);
    expect(near.instrument!.strike).not.toBe(far.instrument!.strike);
  });
});

describe("Per-leg time-to-expiry (Calendar/Diagonal correctness)", () => {
  it("prices each leg off its own expiry instead of one shared strategy-wide T", () => {
    const calendarLegs = buildCalendarLegs(chain, NEAR_EXPIRY, FAR_EXPIRY, SPOT, LOT_SIZE);
    // Give both legs a real premium so T+0 pricing actually engages.
    const legsWithIv: StrategyLeg[] = calendarLegs.map(l => ({ ...l, iv: 0.15, entryPrice: 50 }));

    const profile = calculatePayoffProfile(legsWithIv, SPOT, 0.10, 0.10, 20);
    expect(profile.length).toBeGreaterThan(0);

    // Sanity: T+0 P&L is finite and non-trivial (both legs' BS prices actually
    // computed, not skipped) — if per-leg T wiring were broken this would
    // still "work" numerically, so the real proof is the isolated comparison
    // below against a single-shared-T calculation.
    const sharedTProfile = calculatePayoffProfile(
      legsWithIv.map(l => ({ ...l, instrument: { ...l.instrument!, expiry: NEAR_EXPIRY } })),
      SPOT,
      0.10,
      0.10,
      20
    );

    // Forcing both legs onto the near expiry (shared T) must change the
    // far leg's T+0 price relative to the true per-leg calculation —
    // proving the per-leg expiry is actually being used, not ignored.
    const midIdx = Math.floor(profile.length / 2);
    expect(profile[midIdx].profitT0).not.toBeCloseTo(sharedTProfile[midIdx].profitT0, 2);
  });
});
