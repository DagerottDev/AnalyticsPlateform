"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { NumericParameterInput } from "@/components/charts/NumericParameterInput";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { OHLCVData } from "@/lib/indicators";
import {
  CHART_INDICATOR_DEFINITIONS,
  ChartIndicatorId,
  createDefaultChartIndicators,
} from "@/lib/chartIndicators";
import { Instrument, type MarketTick } from "@/types/market";
import { getInstruments, getHistoricalCandles, getMarketQuotes } from "@/lib/market";
import { useSettingsStore, type ChartTimeframe } from "@/stores/settingsStore";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
import { DataFreshness } from "@/components/market/DataFreshness";
import { Select } from "@/components/ui/Select";
import { defaultSpotFallback, nearestStrikeTo } from "@/lib/optionMath";
import { formatStrikeWithPosition } from "@/lib/strikePositions";
import { quoteLastPrice } from "@/lib/marketTick";
import { combinePremiumCandles, combinedLivePremium } from "@/lib/combinedPremium";

type OptionType = "CE" | "PE";
type ChartMode = "single" | "combined";
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
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(chartPreferences.timeframe);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [optionType, setOptionType] = useState<OptionType>("CE");
  const [chartMode, setChartMode] = useState<ChartMode>("single");
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [snapshotSpot, setSnapshotSpot] = useState<number | null>(null);
  // A picker selection is deliberately seeded from ATM, but a user's choice
  // of an individual strike (including the underlying option) must remain
  // stable while the live spot moves.
  const strikePickerTouchedRef = useRef(false);
  const autoSelectedStrikeRef = useRef<number | null>(null);
  
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
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(
    () => Array.from(new Set([...tradingSymbols, symbol])),
    [symbol, tradingSymbols]
  );
  const { getTick, ticks: marketTicks } = useMarketData(allSymbols); // Subscribe to options + underlying
  // Keep chart rendering safe while the market-data hook is booting (and for
  // lightweight test/offline adapters that only provide getTick).
  const ticks = marketTicks ?? {};
  const underlyingTick = getTick(symbol);
  const spot = underlyingTick?.last_price && underlyingTick.last_price > 0
    ? underlyingTick.last_price
    : snapshotSpot ?? defaultSpotFallback(symbol);
  const atmStrike = useMemo(
    () => availableStrikes.length > 0 ? nearestStrikeTo(availableStrikes, spot) : null,
    [availableStrikes, spot]
  );
  // Resolve the ATM strike during the render that receives the option ladder,
  // so the chart never briefly falls back to the underlying before the
  // selection effect commits. An explicit picker choice always wins.
  const activeStrike = selectedStrike ?? (!strikePickerTouchedRef.current ? atmStrike : null);
  const selectedOption = useMemo<SelectedOption | null>(() => {
    if (activeStrike === null) return null;

    return instruments.find((instrument): instrument is SelectedOption =>
      instrument.strike === activeStrike && instrument.option_type === optionType
    ) ?? null;
  }, [activeStrike, instruments, optionType]);
  const selectedCall = useMemo<SelectedOption | null>(() => {
    if (activeStrike === null) return null;
    return instruments.find((instrument): instrument is SelectedOption => (
      instrument.strike === activeStrike && instrument.option_type === "CE"
    )) ?? null;
  }, [activeStrike, instruments]);
  const selectedPut = useMemo<SelectedOption | null>(() => {
    if (activeStrike === null) return null;
    return instruments.find((instrument): instrument is SelectedOption => (
      instrument.strike === activeStrike && instrument.option_type === "PE"
    )) ?? null;
  }, [activeStrike, instruments]);
  const combinedSymbols = useMemo(
    () => selectedCall && selectedPut ? [selectedCall.trading_symbol, selectedPut.trading_symbol] : [],
    [selectedCall, selectedPut],
  );
  const chartSymbols = useMemo(
    () => chartMode === "combined" ? combinedSymbols : [selectedOption?.trading_symbol ?? symbol],
    [chartMode, combinedSymbols, selectedOption, symbol],
  );
  const chartSymbol = chartSymbols[0] ?? symbol;
  const chartLabel = chartMode === "combined" && activeStrike !== null
    ? `${symbol} ${activeStrike.toLocaleString("en-IN")} CE + PE · ${expiry}`
    : selectedOption
    ? `${symbol} ${selectedOption.strike} ${selectedOption.option_type} · ${expiry}`
    : symbol;

  // Load option contracts for the selected expiry.
  useEffect(() => {
    let isMounted = true;
    if (!symbol || !expiry) {
      setInstruments([]);
      setSelectedStrike(null);
      strikePickerTouchedRef.current = false;
      autoSelectedStrikeRef.current = null;
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

  // The websocket is intentionally paused outside NSE hours. Use the
  // broker's latest traded quote for ATM labels in that state instead of
  // drifting back to a hardcoded index fallback.
  useEffect(() => {
    let isMounted = true;
    setSnapshotSpot(null);

    async function fetchSnapshotSpot() {
      try {
        const { quotes } = await getMarketQuotes([symbol]);
        const quote = quotes.find((item) => item.trading_symbol === symbol) ?? quotes[0];
        const candidate = quoteLastPrice(quote);
        if (isMounted && candidate !== null) setSnapshotSpot(candidate);
      } catch {
        // Keep the symbol-specific fallback when the optional snapshot is
        // unavailable; historical chart loading must remain independent.
      }
    }

    if (symbol) void fetchSnapshotSpot();
    return () => {
      isMounted = false;
    };
  }, [symbol]);

  useEffect(() => {
    if (availableStrikes.length === 0) {
      setSelectedStrike(null);
      autoSelectedStrikeRef.current = null;
      return;
    }
    if (strikePickerTouchedRef.current || atmStrike === null) return;

    setSelectedStrike((current) => {
      const shouldUseAtm = current === null
        || !availableStrikes.includes(current)
        || current === autoSelectedStrikeRef.current;
      if (!shouldUseAtm) return current;
      autoSelectedStrikeRef.current = atmStrike;
      return atmStrike;
    });
  }, [availableStrikes, atmStrike]);

  // Load Historical OHLCV for Chart
  useEffect(() => {
    let isMounted = true;
    if (chartSymbols.length === 0) {
      setLoading(false);
      setChartError(null);
      setHistoricalData([]);
      setChartEmptyMessage("Both the Call and Put contract are required for a combined premium chart.");
      return;
    }

    async function fetchHistorical() {
      setLoading(true);
      setChartError(null);
      setChartEmptyMessage(null);
      setHistoricalData([]);
      try {
        // Individual charts use one broker instrument. Combined mode sums
        // matching CE and PE candles from the selected strike; it is a
        // transparent synthetic premium, not an exchange-traded instrument.
        const rangeTo = new Date();
        const rangeFrom = new Date(rangeTo);
        rangeFrom.setDate(rangeFrom.getDate() - chartPreferences.historyDays);
        const toIso = (d: Date) => d.toISOString().slice(0, 10);

        const candleSets = await Promise.all(chartSymbols.map((requestedSymbol) => (
          getHistoricalCandles(requestedSymbol, toIso(rangeFrom), toIso(rangeTo), timeframe)
        )));
        if (isMounted) {
          const candles = chartMode === "combined"
            ? combinePremiumCandles(candleSets.map((series) => series.map((candle) => ({
              time: candle.timestamp,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            }))))
            : candleSets[0].map((candle) => ({
              time: candle.timestamp,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            }));
          if (candles.length > 0) {
            setHistoricalData(candles);
          } else {
            setHistoricalData([]);
            setChartEmptyMessage(
              chartMode === "combined"
                ? "No matching broker candles were returned for both legs of this combined premium."
                : selectedOption
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
  }, [chartMode, chartPreferences.historyDays, chartSymbols, selectedOption, timeframe]);

  // The active chart instrument receives live updates on top of broker history.
  const singleChartTick = getTick(chartSymbol);
  const combinedPremium = chartMode === "combined" ? combinedLivePremium(combinedSymbols, ticks) : null;
  const combinedTimestamp = combinedSymbols.reduce(
    (latest, requestedSymbol) => Math.max(latest, ticks[requestedSymbol]?.timestamp ?? 0),
    0,
  );
  const combinedStreamTimestamps = combinedSymbols.map((requestedSymbol) => {
    const tick = ticks[requestedSymbol];
    return tick && "last_stream_timestamp" in tick ? tick.last_stream_timestamp : undefined;
  });
  const combinedLastStreamTimestamp = combinedStreamTimestamps.every(
    (timestamp) => typeof timestamp === "number" && timestamp > 0,
  ) ? Math.min(...combinedStreamTimestamps as number[]) : undefined;
  const combinedFeed: MarketTick["feed"] = combinedSymbols.every((requestedSymbol) => {
    const tick = ticks[requestedSymbol];
    return tick && "feed" in tick && tick.feed === "stream";
  }) ? "stream" : "snapshot";
  const chartTick = chartMode === "combined" && combinedPremium !== null ? {
    trading_symbol: `${symbol}:COMBINED_PREMIUM`,
    last_price: combinedPremium,
    volume: 0,
    open_interest: 0,
    timestamp: combinedTimestamp,
    change: 0,
    change_percent: 0,
    feed: combinedFeed,
    last_stream_timestamp: combinedLastStreamTimestamp,
  } : singleChartTick;
  const liveChartTick = chartTick ? { price: chartTick.last_price, timestamp: chartTick.timestamp } : null;

  const handleSymbolChange = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setExpiry(null);
    setInstruments([]);
    setSelectedStrike(null);
    setChartMode("single");
    strikePickerTouchedRef.current = false;
    autoSelectedStrikeRef.current = null;
  };

  const handleExpiryChange = (nextExpiry: string) => {
    setExpiry(nextExpiry);
    setInstruments([]);
    setSelectedStrike(null);
    setChartMode("single");
    strikePickerTouchedRef.current = false;
    autoSelectedStrikeRef.current = null;
  };

  const handleTimeframeChange = (nextTimeframe: ChartTimeframe) => {
    setTimeframe(nextTimeframe);
    useSettingsStore.getState().updatePreferences((current) => ({
      ...current,
      charts: { ...current.charts, timeframe: nextTimeframe },
    }));
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
            <div className="min-w-36 flex-1">
              <label htmlFor="chart-timeframe" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Timeframe
              </label>
              <Select
                id="chart-timeframe"
                value={timeframe}
                onChange={(event) => handleTimeframeChange(event.target.value as ChartTimeframe)}
                title="Reload the chart with a different broker candle interval"
              >
                {["1", "3", "5", "10", "15"].map((value) => (
                  <option key={value} value={value}>{value} minute{value === "1" ? "" : "s"}</option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Reloads broker OHLCV candles.</p>
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor="chart-mode" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Chart data
              </label>
              <Select
                id="chart-mode"
                value={chartMode}
                onChange={(event) => setChartMode(event.target.value as ChartMode)}
                disabled={!expiry || instruments.length === 0}
              >
                <option value="single">Single contract</option>
                <option value="combined" disabled={!selectedCall || !selectedPut}>Combined CE + PE</option>
              </Select>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Sums both premium legs at the selected strike.</p>
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor="chart-option-type" className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Option type
              </label>
              <Select
                id="chart-option-type"
                value={optionType}
                onChange={(event) => {
                  setOptionType(event.target.value as OptionType);
                  setSelectedStrike(null);
                  strikePickerTouchedRef.current = false;
                  autoSelectedStrikeRef.current = null;
                }}
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
                value={activeStrike === null ? "" : String(activeStrike)}
                onChange={(event) => {
                  strikePickerTouchedRef.current = true;
                  setSelectedStrike(event.target.value ? Number(event.target.value) : null);
                }}
                disabled={!expiry || availableStrikes.length === 0}
              >
                <option value="">Underlying ({symbol})</option>
                {availableStrikes.map((strike) => (
                  <option
                    key={strike}
                    value={strike}
                    // Keep the numeric accessible name stable for keyboard
                    // users while the visible option text carries the
                    // market-relative position.
                    aria-label={strike.toLocaleString("en-IN")}
                  >
                    {formatStrikeWithPosition(strike, availableStrikes, spot, optionType)}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                ATM: {atmStrike === null ? "—" : atmStrike.toLocaleString("en-IN")} · spot {spot.toLocaleString("en-IN")}
              </p>
            </div>
            <p className="max-w-64 text-xs leading-5 text-[var(--color-text-secondary)]">
              {chartMode === "combined"
                ? activeStrike === null
                  ? "Choose a strike to chart the combined Call + Put premium."
                  : "Charting a synthetic CE + PE premium from matching broker candles and live leg prices."
                : selectedOption
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
                    <NumericParameterInput
                      ariaLabel={`${indicator.label} ${parameter.label}`}
                      value={indicators[indicator.id].parameters[parameter.key]}
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.step}
                      integer={parameter.step === 1}
                      onValueChange={(value) => updateIndicatorParameter(indicator.id, parameter.key, value)}
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
            timeframeLabel={`${timeframe}m`}
          />
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
