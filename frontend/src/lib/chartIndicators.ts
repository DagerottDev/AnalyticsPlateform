/**
 * The chart's single source of truth for indicator defaults and editable
 * parameters. Add every future chart indicator here before rendering it so
 * applied indicators always have real-time settings in the UI.
 */
export type ChartIndicatorId = "sma" | "ema" | "bbands" | "rsi" | "supertrend";

export interface IndicatorParameterDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface ChartIndicatorDefinition {
  id: ChartIndicatorId;
  label: string;
  parameters: IndicatorParameterDefinition[];
  defaults: Record<string, number>;
}

export interface ChartIndicatorSettings {
  enabled: boolean;
  parameters: Record<string, number>;
}

export type ChartIndicators = Record<ChartIndicatorId, ChartIndicatorSettings>;

export const CHART_INDICATOR_DEFINITIONS: ChartIndicatorDefinition[] = [
  {
    id: "sma",
    label: "SMA",
    parameters: [{ key: "period", label: "Length", min: 2, max: 500, step: 1 }],
    defaults: { period: 20 },
  },
  {
    id: "ema",
    label: "EMA",
    parameters: [{ key: "period", label: "Length", min: 2, max: 500, step: 1 }],
    defaults: { period: 20 },
  },
  {
    id: "bbands",
    label: "Bollinger",
    parameters: [
      { key: "period", label: "Length", min: 2, max: 500, step: 1 },
      { key: "multiplier", label: "Std dev", min: 0.1, max: 10, step: 0.1 },
    ],
    defaults: { period: 20, multiplier: 2 },
  },
  {
    id: "rsi",
    label: "RSI",
    parameters: [{ key: "period", label: "Length", min: 2, max: 500, step: 1 }],
    defaults: { period: 14 },
  },
  {
    id: "supertrend",
    label: "Supertrend",
    parameters: [
      { key: "period", label: "ATR length", min: 2, max: 500, step: 1 },
      { key: "multiplier", label: "Multiplier", min: 1, max: 10, step: 1 },
    ],
    defaults: { period: 10, multiplier: 3 },
  },
];

export function createDefaultChartIndicators(): ChartIndicators {
  return Object.fromEntries(
    CHART_INDICATOR_DEFINITIONS.map((indicator) => [
      indicator.id,
      { enabled: false, parameters: { ...indicator.defaults } },
    ])
  ) as ChartIndicators;
}

export function indicatorParameter(
  indicators: ChartIndicators | undefined,
  indicatorId: ChartIndicatorId,
  parameter: string
): number {
  const definition = CHART_INDICATOR_DEFINITIONS.find((item) => item.id === indicatorId);
  return indicators?.[indicatorId]?.parameters[parameter] ?? definition?.defaults[parameter] ?? 0;
}
