/**
 * Named multi-leg strategy templates (Iron Condor, Straddle, Strangle,
 * Butterfly, Calendar, Diagonal). Each builder returns a `StrategyLeg[]`
 * that can be dropped straight into the generic LegManager/payoff engine —
 * these are just pre-populated leg sets, not a separate pricing path.
 *
 * entryPrice/iv are left at their normal LegManager defaults (0 / 0.15);
 * the existing live-tick auto-fill in strategy/page.tsx populates real
 * values once ticks arrive for the selected legs, same as manually-added ones.
 */
import { Instrument } from "@/types/market";
import { StrategyLeg } from "./strategy";
import { nearestStrikeTo as nearestOf } from "./optionMath";

function uniqueSortedStrikes(instruments: Instrument[], expiry: string): number[] {
  const strikes = new Set<number>();
  instruments.forEach(i => {
    if (i.expiry === expiry && typeof i.strike === "number") strikes.add(i.strike);
  });
  return Array.from(strikes).sort((a, b) => a - b);
}

/** Median gap between consecutive available strikes — the instrument's real strike interval. */
function inferStrikeStep(instruments: Instrument[], expiry: string): number {
  const strikes = uniqueSortedStrikes(instruments, expiry);
  if (strikes.length < 2) return 50;
  const gaps = strikes.slice(1).map((s, i) => s - strikes[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function findInstrument(
  instruments: Instrument[],
  expiry: string,
  optionType: "CE" | "PE",
  targetStrike: number
): Instrument | null {
  const candidates = instruments.filter(i => i.expiry === expiry && i.option_type === optionType);
  if (candidates.length === 0) return null;
  return candidates.reduce((closest, curr) =>
    Math.abs((curr.strike ?? Infinity) - targetStrike) < Math.abs((closest.strike ?? Infinity) - targetStrike)
      ? curr
      : closest
  );
}

function nearestStrikeTo(instruments: Instrument[], expiry: string, target: number): number {
  return nearestOf(uniqueSortedStrikes(instruments, expiry), target);
}

function makeLeg(instrument: Instrument | null, action: "Buy" | "Sell", quantity: number): StrategyLeg {
  return {
    id: Math.random().toString(36).slice(2, 11),
    instrument,
    action,
    quantity,
    entryPrice: 0,
    iv: 0.15,
  };
}

/** Sell an OTM put + OTM call (the body), buy further OTM put + call (the wings) for protection. */
export function buildIronCondorLegs(
  instruments: Instrument[],
  expiry: string,
  spot: number,
  lotSize: number,
  shortSteps: number = 4,
  wingSteps: number = 4
): StrategyLeg[] {
  const step = inferStrikeStep(instruments, expiry);
  const atm = nearestStrikeTo(instruments, expiry, spot);

  const shortPutStrike = atm - shortSteps * step;
  const longPutStrike = shortPutStrike - wingSteps * step;
  const shortCallStrike = atm + shortSteps * step;
  const longCallStrike = shortCallStrike + wingSteps * step;

  return [
    makeLeg(findInstrument(instruments, expiry, "PE", longPutStrike), "Buy", lotSize),
    makeLeg(findInstrument(instruments, expiry, "PE", shortPutStrike), "Sell", lotSize),
    makeLeg(findInstrument(instruments, expiry, "CE", shortCallStrike), "Sell", lotSize),
    makeLeg(findInstrument(instruments, expiry, "CE", longCallStrike), "Buy", lotSize),
  ];
}

/** Same strike, same expiry, Call + Put — a bet on volatility (direction-agnostic). */
export function buildStraddleLegs(
  instruments: Instrument[],
  expiry: string,
  spot: number,
  lotSize: number,
  action: "Buy" | "Sell" = "Buy"
): StrategyLeg[] {
  const atm = nearestStrikeTo(instruments, expiry, spot);
  return [
    makeLeg(findInstrument(instruments, expiry, "CE", atm), action, lotSize),
    makeLeg(findInstrument(instruments, expiry, "PE", atm), action, lotSize),
  ];
}

/** OTM Call above spot + OTM Put below spot, same expiry — cheaper than a straddle, needs a bigger move. */
export function buildStrangleLegs(
  instruments: Instrument[],
  expiry: string,
  spot: number,
  lotSize: number,
  offsetSteps: number = 4,
  action: "Buy" | "Sell" = "Buy"
): StrategyLeg[] {
  const step = inferStrikeStep(instruments, expiry);
  const atm = nearestStrikeTo(instruments, expiry, spot);
  const callStrike = atm + offsetSteps * step;
  const putStrike = atm - offsetSteps * step;

  return [
    makeLeg(findInstrument(instruments, expiry, "CE", callStrike), action, lotSize),
    makeLeg(findInstrument(instruments, expiry, "PE", putStrike), action, lotSize),
  ];
}

/** Buy 1 lower strike, sell 2 ATM, buy 1 higher strike (all calls) — profits if price pins near ATM. */
export function buildButterflyLegs(
  instruments: Instrument[],
  expiry: string,
  spot: number,
  lotSize: number,
  wingSteps: number = 4
): StrategyLeg[] {
  const step = inferStrikeStep(instruments, expiry);
  const atm = nearestStrikeTo(instruments, expiry, spot);
  const lowerStrike = atm - wingSteps * step;
  const upperStrike = atm + wingSteps * step;

  return [
    makeLeg(findInstrument(instruments, expiry, "CE", lowerStrike), "Buy", lotSize),
    makeLeg(findInstrument(instruments, expiry, "CE", atm), "Sell", lotSize * 2),
    makeLeg(findInstrument(instruments, expiry, "CE", upperStrike), "Buy", lotSize),
  ];
}

/** Same strike, two expiries — sell the near-term leg, buy the far-term leg (theta-decay play). */
export function buildCalendarLegs(
  instruments: Instrument[],
  nearExpiry: string,
  farExpiry: string,
  spot: number,
  lotSize: number,
  optionType: "CE" | "PE" = "CE"
): StrategyLeg[] {
  const atm = nearestStrikeTo(instruments, nearExpiry, spot);
  return [
    makeLeg(findInstrument(instruments, nearExpiry, optionType, atm), "Sell", lotSize),
    makeLeg(findInstrument(instruments, farExpiry, optionType, atm), "Buy", lotSize),
  ];
}

/** Different strikes AND different expiries — sell near-term OTM, buy far-term further OTM. */
export function buildDiagonalLegs(
  instruments: Instrument[],
  nearExpiry: string,
  farExpiry: string,
  spot: number,
  lotSize: number,
  offsetSteps: number = 4,
  optionType: "CE" | "PE" = "CE"
): StrategyLeg[] {
  const step = inferStrikeStep(instruments, nearExpiry);
  const atm = nearestStrikeTo(instruments, nearExpiry, spot);
  const direction = optionType === "CE" ? 1 : -1;
  const nearStrike = atm + direction * offsetSteps * step;
  const farStrike = atm + direction * (offsetSteps + 2) * step;

  return [
    makeLeg(findInstrument(instruments, nearExpiry, optionType, nearStrike), "Sell", lotSize),
    makeLeg(findInstrument(instruments, farExpiry, optionType, farStrike), "Buy", lotSize),
  ];
}

export type StrategyPresetName =
  | "Iron Condor"
  | "Straddle"
  | "Strangle"
  | "Butterfly"
  | "Calendar"
  | "Diagonal";

export const SINGLE_EXPIRY_PRESETS: readonly StrategyPresetName[] = [
  "Iron Condor",
  "Straddle",
  "Strangle",
  "Butterfly",
];

export const MULTI_EXPIRY_PRESETS: readonly StrategyPresetName[] = ["Calendar", "Diagonal"];
