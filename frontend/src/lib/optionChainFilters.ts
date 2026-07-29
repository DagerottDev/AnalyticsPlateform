import type { Instrument } from "@/types/market";

export type MoneynessFilter = "all" | "itm" | "atm" | "otm";

export interface OptionChainStrikeRow {
  strike: number;
  CE?: Instrument;
  PE?: Instrument;
}

/** Filters rows by call moneyness and their distance from the ATM strike. */
export function filterOptionChainStrikes(
  rows: OptionChainStrikeRow[],
  atmStrike: number,
  moneyness: MoneynessFilter,
  strikesEachSide: number | null
): OptionChainStrikeRow[] {
  const atmIndex = rows.findIndex((row) => row.strike === atmStrike);

  return rows.filter((row, index) => {
    if (strikesEachSide !== null && atmIndex >= 0 && Math.abs(index - atmIndex) > strikesEachSide) {
      return false;
    }
    if (moneyness === "atm") return row.strike === atmStrike;
    if (moneyness === "itm") return row.strike < atmStrike;
    if (moneyness === "otm") return row.strike > atmStrike;
    return true;
  });
}

export function toCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
