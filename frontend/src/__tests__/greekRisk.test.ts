import { describe, expect, it } from "vitest";
import { aggregateRiskExposure, atr14, quotePrice, scenarioResults, type PricedRiskLeg } from "@/lib/greekRisk";
import { displayGreekPoints } from "@/lib/greekPresentation";
import { gammaFlip } from "@/lib/marketStructure";

const leg = (side: "Buy" | "Sell", quantity: number): PricedRiskLeg => ({
  side, quantity, premium: 100, iv: .2, quoteQuality: "mid",
  instrument: { trading_symbol: "NFO:TEST", symbol: "TEST", instrument_type: "OPT", expiry: "06-Aug-2026", strike: 100, option_type: "CE", exchange: "NFO", lot_size: 50 },
  greeks: { price: 100, delta: .5, gamma: .01, theta: -1, vega: 2, rho: .1, vanna: .01, vomma: .02, charm: .001, speed: 0, color: 0, zomma: 0, ultima: 0 },
});

describe("Greek risk analysis", () => {
  it("uses midpoint before LTP and keeps source provenance", () => {
    expect(quotePrice({ bid: 98, ask: 102 } as never)).toEqual({ price: 100, quality: "mid" });
    expect(quotePrice({ last_price: 99 } as never)).toEqual({ price: 99, quality: "ltp" });
  });
  it("aggregates signed lot quantities and derives ATR scenarios", () => {
    expect(aggregateRiskExposure([leg("Buy", 50), leg("Sell", 20)]).delta).toBe(15);
    expect(atr14([{ high: 110, low: 90, close: 100 }, { high: 115, low: 95, close: 105 }])).toBe(20);
    expect(scenarioResults([leg("Buy", 1)], 100, 5, .1, Date.UTC(2026, 7, 1)).length).toBe(3);
  });
  it("keeps display normalization separate from native Greek values and interpolates gamma transitions", () => {
    const points = [{ time: "2026-08-05T09:15:00Z", value: 4 }, { time: "2026-08-05T09:20:00Z", value: 6 }];
    expect(displayGreekPoints(points, "native")).toEqual(points);
    expect(displayGreekPoints(points, "change").map((point) => point.value)).toEqual([0, 2]);
    expect(gammaFlip([{ strike: 100, gamma: -2 }, { strike: 110, gamma: 2 }] as never)).toBe(105);
  });
});
