import { describe, expect, it } from "vitest";
import {
  CHART_INDICATOR_DEFINITIONS,
  createDefaultChartIndicators,
  indicatorParameter,
} from "../lib/chartIndicators";

describe("chart indicator definitions", () => {
  it("creates disabled indicators with their documented editable defaults", () => {
    const indicators = createDefaultChartIndicators();

    expect(indicators.sma).toEqual({ enabled: false, parameters: { period: 20 } });
    expect(indicators.bbands.parameters).toEqual({ period: 20, multiplier: 2 });
    expect(indicators.supertrend.parameters).toEqual({ period: 10, multiplier: 3 });
  });

  it("provides an editable parameter definition for every indicator", () => {
    expect(CHART_INDICATOR_DEFINITIONS.every((indicator) => indicator.parameters.length > 0)).toBe(true);
    expect(indicatorParameter(undefined, "rsi", "period")).toBe(14);
  });
});
