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

  it("uses integer values for Supertrend multipliers", () => {
    const supertrend = CHART_INDICATOR_DEFINITIONS.find((indicator) => indicator.id === "supertrend");
    expect(supertrend?.parameters.find((parameter) => parameter.key === "multiplier")).toMatchObject({ min: 1, max: 10, step: 1 });
  });
});
