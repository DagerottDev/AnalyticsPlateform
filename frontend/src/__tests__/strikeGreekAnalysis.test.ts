import { describe, expect, it } from "vitest";
import { buildGreekRatios, buildStrikeGreekSeries } from "@/lib/strikeGreekAnalysis";

describe("selected strike Greek analysis", () => {
  it("keeps only matched option and underlying history when calculating Greeks", () => {
    const data = buildStrikeGreekSeries([{ trading_symbol: "CE", symbol: "NIFTY", instrument_type: "OPT", expiry: "31-Dec-2026", strike: 22000, option_type: "CE", exchange: "NFO" }], {
      CE: [{ timestamp: "2026-07-01T09:15:00Z", open: 300, high: 300, low: 300, close: 300, volume: 0, open_interest: 0 }],
    }, [{ timestamp: "2026-07-01T09:15:00Z", open: 22000, high: 22000, low: 22000, close: 22000, volume: 0, open_interest: 0 }]);
    expect(data.delta.CE).toHaveLength(1);
    expect(data.vanna.CE[0].value).toBeTypeOf("number");
  });

  it("calculates contract-to-base Greek ratios", () => {
    expect(buildGreekRatios({ base: [{ time: "t", value: 2 }], other: [{ time: "t", value: 3 }] }, "base")).toEqual({ other: [{ time: "t", value: 1.5 }] });
  });
});
