import { describe, expect, it } from "vitest";
import { filterOptionChainStrikes, toCsvCell } from "../lib/optionChainFilters";

const rows = [18000, 18100, 18200, 18300, 18400].map((strike) => ({ strike }));

describe("option chain filters", () => {
  it("filters rows by call moneyness relative to ATM", () => {
    expect(filterOptionChainStrikes(rows, 18200, "itm", null).map((row) => row.strike)).toEqual([18000, 18100]);
    expect(filterOptionChainStrikes(rows, 18200, "atm", null).map((row) => row.strike)).toEqual([18200]);
    expect(filterOptionChainStrikes(rows, 18200, "otm", null).map((row) => row.strike)).toEqual([18300, 18400]);
  });

  it("limits the display to a strike count on each side of ATM", () => {
    expect(filterOptionChainStrikes(rows, 18200, "all", 1).map((row) => row.strike)).toEqual([18100, 18200, 18300]);
  });

  it("escapes CSV cells that contain special characters", () => {
    expect(toCsvCell('NIFTY, "weekly"')).toBe('"NIFTY, ""weekly"""');
  });
});
