import { describe, expect, it } from "vitest";
import { createDefaultUserPreferences } from "@/stores/settingsStore";

describe("user settings defaults", () => {
  it("keeps the existing application defaults in one typed profile", () => {
    const preferences = createDefaultUserPreferences();

    expect(preferences.general).toEqual({ defaultSymbol: "NIFTY", watchlist: ["NIFTY", "BANKNIFTY"] });
    expect(preferences.charts).toMatchObject({ timeframe: "1", historyDays: 7, refreshSeconds: 30 });
    expect(preferences.charts.indicators.supertrend.parameters).toEqual({ period: 10, multiplier: 2 });
    expect(preferences.optionChain).toEqual({
      showGreeks: true,
      showBuildup: true,
      moneyness: "all",
      strikesEachSide: 10,
      defaultGttValidityDays: 30,
      rollingSelectionMode: "smooth",
    });
    expect(preferences.combinedPremiumWorkspace).toMatchObject({
      timeframe: "3",
      syncCharts: true,
      seriesType: "candlestick",
    });
    expect(preferences.greekWorkspace.timeframe).toBe("3");
    expect(preferences.combinedPremiumWorkspace.indicators.calls.ema.enabled).toBe(true);
    expect(preferences.ivScreener).toEqual({ projectionDays: 14, sigma: 1 });
    expect(preferences.replay.fallbackIvPercent).toMatchObject({ NIFTY: 14, BANKNIFTY: 18, DEFAULT: 15 });
    expect(preferences.analytics.riskFreeRatePercent).toMatchObject({ NIFTY: 10, SENSEX: 10, DEFAULT: 10 });
  });
});
