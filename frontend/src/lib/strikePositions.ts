import { nearestStrikeTo } from "./optionMath";

export type OptionSide = "CE" | "PE";

export interface StrikePosition {
  atmStrike: number;
  distance: number;
  call: string;
  put: string;
}

/**
 * Resolve a strike's moneyness relative to the closest strike to spot.
 *
 * The distance is measured in strikes rather than rupees so the label stays
 * useful across index and stock option ladders (and across different strike
 * steps). Calls and puts intentionally use opposite OTM/ITM directions.
 */
export function getStrikePosition(
  strike: number,
  strikes: number[],
  spot: number,
): StrikePosition | null {
  const ladder = Array.from(new Set(strikes.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
  const strikeIndex = ladder.indexOf(strike);
  if (strikeIndex < 0 || ladder.length === 0) return null;

  const target = Number.isFinite(spot) ? spot : ladder[0];
  const atmStrike = nearestStrikeTo(ladder, target);
  const atmIndex = ladder.indexOf(atmStrike);
  const distance = Math.abs(strikeIndex - atmIndex);
  if (distance === 0) {
    return { atmStrike, distance: 0, call: "ATM", put: "ATM" };
  }

  const callMoneyness = strike > atmStrike ? "OTM" : "ITM";
  const putMoneyness = strike < atmStrike ? "OTM" : "ITM";
  return {
    atmStrike,
    distance,
    call: `${callMoneyness} ${distance}`,
    put: `${putMoneyness} ${distance}`,
  };
}

/** A compact label for a strike selector or option contract list. */
export function strikePositionLabel(
  strike: number,
  strikes: number[],
  spot: number,
  side: OptionSide | "BOTH" = "BOTH",
): string {
  const position = getStrikePosition(strike, strikes, spot);
  if (!position) return "Position unavailable";
  if (side === "CE") return position.call;
  if (side === "PE") return position.put;
  if (position.call === position.put) return position.call;
  return `CE ${position.call} / PE ${position.put}`;
}

/** Format a strike with its market-relative position for a visible picker. */
export function formatStrikeWithPosition(
  strike: number,
  strikes: number[],
  spot: number,
  side: OptionSide | "BOTH" = "BOTH",
): string {
  return `${strike.toLocaleString("en-IN")} · ${strikePositionLabel(strike, strikes, spot, side)}`;
}
