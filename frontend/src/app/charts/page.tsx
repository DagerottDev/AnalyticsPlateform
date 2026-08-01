"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { OHLCVData } from "@/lib/indicators";
import {
  CHART_INDICATOR_DEFINITIONS,
  ChartIndicatorId,
  createDefaultChartIndicators,
} from "@/lib/chartIndicators";
import { Instrument } from "@/types/market";
import { getInstruments, getHistoricalCandles } from "@/lib/market";
import { useSettingsStore } from "@/stores/settingsStore";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { DataFreshness } from "@/components/market/DataFreshness";
import { Select } from "@/components/ui/Select";

type OptionType = "CE" | "PE";
type SelectedOption = Instrument & { strike: number; option_type: OptionType };
const FALLBACK_CHART_PREFERENCES = {
  timeframe: "1" as const,
  historyDays: 7,
  refreshSeconds: 30 as const,
  indicators: createDefaultChartIndicators(),
};

export default function ChartsPage() {
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const chartPreferences = useMemo(
    () => useSettingsStore.getState().charts ?? FALLBACK_CHART_PREFERENCES,
    []
  );
  const [expiry, setExpiry] = useState<string | null>(null);
  const [optionType, setOptionType] = useState<OptionType>("CE");
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  
  const [historicalData, setHistoricalData] = useState<OHLCVData[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState<unknown>(null);
  const [chartEmptyMessage, setChartEmptyMessage] = useState<string | null>(null);

  const [indicators, setIndicators] = useState(() => chartPreferences.indicators ?? createDefaultChartIndicators());

  useEffect(() => {
    setIndicators(chartPreferences.indicators);
  }, [chartPreferences.indicators]);

  const updateIndicatorParameter = (
    indicatorId: ChartIndicatorId,
    parameter: string,
    value: number
  ) => {
    setIndicators((current) => ({
      ...current,
      [indicatorId]: {
        ...current[indicatorId],
        parameters: { ...current[indicatorId].parameters, [parameter]: value },
      },
    }));
  };
  
  // Option contracts for the strike selector.
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const availableStrikes = useMemo(
    () => Array.from(new Set(instruments.flatMap((instrument) =>
      instrument.option_type === optionType && typeof instrument.strike === "number"
        ? [instrument.strike]
        : []
    ))).sort((left, right) => left - right),
    [instruments, optionType]
  );
  const selectedOption = useMemo<SelectedOption | null>(() => {
    if (selectedStrike === null) return null;

    return instruments.find((instrument): instrument is SelectedOption =>
      instrument.strike === selectedStrike && instrument.option_type === optionType
    ) ?? null;
  }, [instruments, optionType, selectedStrike]);
  const chartSymbol = selectedOption?.trading_symbol ?? symbol;
  const chartLabel = selectedOption
    ? `${symbol} ${selectedOption.strike} ${selectedOption.option_type} · ${expiry}`
    : symbol;
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(
    () => Array.from(new Set([...tradingSymbols, symbol, chartSymbol])),
    [chartSymbol, symbol, tradingSymbols]
  );
  const { getTick } = useMarketData(allSymbols); // Subscribe to options + underlying

  // Load option contracts for the selected expiry.
  useEffect(() => {
    let isMounted = true;
    if (!symbol || !expiry) {
      setInstruments([]);
      setSelectedStrike(null);
      return;
    }

    async function fetchContracts() {
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          const filtered = data.instruments.filter((i) => i.expiry === expiry);
          setInstruments(filtered);
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol, expiry]);

  useEffect(() => {
    setSelectedStrike((current) =>
      current !== null && !availableStrikes.includes(current) ? null : current
    );
  }, [availableStrikes]);

  // Load Historical OHLCV for Chart
  useEffect(() => {
    let isMounted = true;
    if (!chartSymbol) return;

    async function fetchHistorical() {
      setLoading(true);
      setChartError(null);
      setChartEmptyMessage(null);
      setHistoricalData([]);
      try {
        // Pulled directly from the broker. When a strike is selected,
        // chartSymbol is that exact exchange-qualified option contract, so
        // this is real option OHLCV rather than a synthetic premium series.
        const rangeTo = new Date();
        const rangeFrom = new Date(rangeTo);
        rangeFrom.setDate(rangeFrom.getDate() - chartPreferences.historyDays);
        const toIso = (d: Date) => d.toISOString().slice(0, 10);

        const candles = await getHistoricalCandles(chartSymbol, toIso(rangeFrom), toIso(rangeTo), chartPreferences.timeframe);
        if (isMounted) {
          if (candles.length > 0) {
            setHistoricalData(
              candles.map((c) => ({
                time: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              }))
            );
          } else {
            setHistoricalData([]);
            setChartEmptyMessage(
              selectedOption
                ? "No real historical data was returned by the broker for this option contract."
                : "No historical data was returned for this symbol."
            );
          }
        }
      } catch (err) {
        console.error("Failed to fetch historical data", err);
        if (!isMounted) return;
        setHistoricalData([]);
        setChartError(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchHistorical();

    return () => { isMounted = false; };
  }, [chartPreferences.historyDays, chartPreferences.timeframe, chartSymbol, selectedOption]);

  // The active chart instrument receives live updates on top of broker history.
  const chartTick = getTick(chartSymbol);
  const liveChartTick = chartTick ? { price: chartTick.last_price, timestamp: chartTick.timestamp } : null;

  const handleSymbolChange = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setExpiry(null);
    setSelectedStrike(null);
  };

  const handleExpiryChange = (nextExpiry: string) => {
    setExpiry(nextExpiry);
    setSelectedStrike(null);
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Advanced Charting" description="Broker-sourced historical OHLCV, live overlays, and indicators." />
          <DataFreshness tick={chartTick} />
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={handleSymbolChange}
            expiry={expiry}
            onExpiryChange={handleExpiryChange}
          />

          <Card className="flex flex-1 flex-wrap items-end gap-3 p-3">
            <div className="min-w-40 flex-1">
              <label htmlFor="chart-option-type" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Option type
              </label>
              <Select
                id="chart-option-type"
                value={optionType}
                onChange={(event) => setOptionType(event.target.value as OptionType)}
                disabled={!expiry || instruments.length === 0}
              >
                <option value="CE">Call (CE)</option>
                <option value="PE">Put (PE)</option>
              </Select>
            </div>
            <div className="min-w-44 flex-1">
              <label htmlFor="chart-option-strike" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Strike price
              </label>
              <Select
                id="chart-option-strike"
                value={selectedStrike === null ? "" : String(selectedStrike)}
                onChange={(event) => setSelectedStrike(event.target.value ? Number(event.target.value) : null)}
                disabled={!expiry || availableStrikes.length === 0}
              >
                <option value="">Underlying ({symbol})</option>
                {availableStrikes.map((strike) => (
                  <option key={strike} value={strike}>{strike.toLocaleString()}</option>
                ))}
              </Select>
            </div>
            <p className="max-w-64 text-xs leading-5 text-[var(--color-text-secondary)]">
              {selectedOption
                ? `Charting real broker OHLCV for ${selectedOption.strike.toLocaleString()} ${selectedOption.option_type}.`
                : "Select a strike to chart that option contract's real broker OHLCV."}
            </p>
          </Card>

          <Card className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-3 p-3">
            <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Indicators:</span>
            {CHART_INDICATOR_DEFINITIONS.map((indicator) => (
              <div key={indicator.id} className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)] hover:text-[var(--color-text-bright)]">
                  <input
                    type="checkbox"
                    checked={indicators[indicator.id].enabled}
                    onChange={() => setIndicators((current) => ({
                      ...current,
                      [indicator.id]: {
                        ...current[indicator.id],
                        enabled: !current[indicator.id].enabled,
                      },
                    }))}
                    className="accent-[var(--color-accent-blue)]"
                  />
                  {indicator.label}
                </label>
                {indicators[indicator.id].enabled && indicator.parameters.map((parameter) => (
                  <label key={parameter.key} className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                    <span>{parameter.label}</span>
                    <input
                      aria-label={`${indicator.label} ${parameter.label}`}
                      type="number"
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.step}
                      value={indicators[indicator.id].parameters[parameter.key]}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value)) {
                          updateIndicatorParameter(
                            indicator.id,
                            parameter.key,
                            Math.min(parameter.max, Math.max(parameter.min, value))
                          );
                        }
                      }}
                      className="w-14 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-1.5 py-1 text-xs text-[var(--color-text-bright)] outline-none focus:border-[var(--color-accent-blue)]"
                    />
                  </label>
                ))}
              </div>
            ))}
          </Card>
        </div>

        {/* Price chart now uses the full workspace width. Open-interest
            analysis lives in its dedicated, chart-dense workspace. */}
        {loading ? (
          <Card>
            <LoadingState size="lg" label="Loading chart data..." />
          </Card>
        ) : chartError ? (
          <Card className="flex flex-col gap-3">
            <EmptyState title="Failed to load chart data" />
            <ApiErrorDisplay error={chartError} />
          </Card>
        ) : chartEmptyMessage ? (
          <Card>
            <EmptyState title="No chart data available" description={chartEmptyMessage} />
          </Card>
        ) : (
          <TradingChart
            data={historicalData}
            liveTick={liveChartTick}
            indicators={indicators}
            symbol={chartLabel}
            timeframeLabel={`${chartPreferences.timeframe}m`}
          />
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
