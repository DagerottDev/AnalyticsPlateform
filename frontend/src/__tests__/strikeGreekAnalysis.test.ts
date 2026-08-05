import { describe, expect, it } from "vitest";
import { appendLiveGreekValues, buildGreekRatios, buildReplayResolvedGreekSeries, buildStrikeGreekSeries, calculateLiveCombinedGreeks, calculateLiveResolvedGreeks, combineGreekSeries } from "@/lib/strikeGreekAnalysis";
import { fixedSelection } from "@/lib/analysisSelections";
import type { Instrument, MarketTick } from "@/types/market";

const instruments: Instrument[] = [
  { trading_symbol: "CE", symbol: "NIFTY", instrument_type: "OPT", expiry: "31-Dec-2030", strike: 22000, option_type: "CE", exchange: "NFO" },
  { trading_symbol: "PE", symbol: "NIFTY", instrument_type: "OPT", expiry: "31-Dec-2030", strike: 22000, option_type: "PE", exchange: "NFO" },
];

const candle = (close: number) => ({ timestamp: "2026-07-01T09:15:00Z", open: close, high: close, low: close, close, volume: 0, open_interest: 0 });

const tick = (trading_symbol: string, last_price: number, timestamp = Date.now()): MarketTick => ({
  trading_symbol,
  last_price,
  volume: 0,
  open_interest: 0,
  timestamp,
  change: 0,
  change_percent: 0,
});

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

  it("combines every selected strike into one summed Greek series", () => {
    const perContract = buildStrikeGreekSeries(instruments, { CE: [candle(400)], PE: [candle(350)] }, [candle(22000)]);
    const combined = combineGreekSeries(perContract);

    expect(combined.delta).toEqual([{ time: "2026-07-01T09:15:00Z", value: perContract.delta.CE[0].value + perContract.delta.PE[0].value }]);
    expect(combined.gamma).toHaveLength(1);
  });

  it("updates from available live legs and reports quote coverage", () => {
    expect(calculateLiveCombinedGreeks(instruments, "NIFTY", { NIFTY: tick("NIFTY", 22000), CE: tick("CE", 400) })?.liveContracts).toBe(1);

    const live = calculateLiveCombinedGreeks(instruments, "NIFTY", {
      NIFTY: tick("NIFTY", 22000), CE: tick("CE", 400), PE: tick("PE", 350),
    });
    expect(live?.values.delta).toBeTypeOf("number");
    expect(live?.liveContracts).toBe(2);
    expect(live?.totalContracts).toBe(2);

    const appended = appendLiveGreekValues({
      delta: [{ time: "2026-07-01T09:15:00Z", value: 1 }], gamma: [], theta: [], vega: [], rho: [], vanna: [], vomma: [], charm: [], speed: [], color: [], zomma: [], ultima: [],
    }, live);
    expect(appended.delta).toHaveLength(2);
    expect(appended.delta[1].time).toMatch(/\.000Z$/);
  });

  it("calculates live Greeks from a complete distance-weighted rolling selection", () => {
    const resolution = {
      components: [{ instrument: instruments[0], weight: 0.5 }, { instrument: { ...instruments[0], trading_symbol: "CE2", strike: 22100 }, weight: 0.5 }],
      effectiveStrike: 22050,
      optionType: "CE" as const,
      mode: "smooth" as const,
    };
    const live = calculateLiveResolvedGreeks([resolution], "NIFTY", {
      NIFTY: tick("NIFTY", 22050), CE: tick("CE", 400), CE2: tick("CE2", 350),
    });
    expect(live?.liveContracts).toBe(1);
    expect(live?.totalContracts).toBe(1);
    expect(live?.values.delta).toBeTypeOf("number");
  });

  it("builds replay Greeks from the fed candle time, not the browser clock", () => {
    const firstTime = new Date("2026-07-21T03:45:00Z").getTime();
    const secondTime = new Date("2026-07-21T03:46:00Z").getTime();
    const replaySeries = buildReplayResolvedGreekSeries(
      [fixedSelection("CE")],
      { CE: instruments[0] },
      instruments,
      [
        { NIFTY: tick("NIFTY", 22000, firstTime), CE: tick("CE", 400, firstTime) },
        { NIFTY: tick("NIFTY", 22100, secondTime), CE: tick("CE", 350, secondTime) },
      ],
      1,
      "NIFTY",
    );

    expect(replaySeries.delta["fixed:CE"]).toHaveLength(2);
    expect(replaySeries.delta["fixed:CE"][0].time).toBe("2026-07-21T03:45:00.000Z");
    expect(replaySeries.delta["fixed:CE"][1].time).toBe("2026-07-21T03:46:00.000Z");
  });
});
