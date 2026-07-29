"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { Heatmap } from "@/components/charts/Heatmap";
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
import { formatApiError } from "@/lib/apiError";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";

export default function ChartsPage() {
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(null);
  
  const [historicalData, setHistoricalData] = useState<OHLCVData[]>([]);
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [indicators, setIndicators] = useState(createDefaultChartIndicators);

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
  
  // For Heatmap
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const { getTick } = useMarketData(allSymbols); // Subscribe to options + underlying

  // Load option chain for Heatmap
  useEffect(() => {
    let isMounted = true;
    if (!symbol || !expiry) {
      setInstruments([]);
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

  // Load Historical OHLCV for Chart
  useEffect(() => {
    let isMounted = true;
    if (!symbol) return;

    async function fetchHistorical() {
      setLoading(true);
      setChartError(null);
      try {
        // Pulled live from the broker (same path as Replay Mode) — the
        // market_data DB table has no backfill job writing to it yet, so
        // the DB-backed /historical/ohlcv endpoint is always empty.
        const rangeTo = new Date();
        const rangeFrom = new Date(rangeTo);
        rangeFrom.setDate(rangeFrom.getDate() - 7);
        const toIso = (d: Date) => d.toISOString().slice(0, 10);

        const candles = await getHistoricalCandles(symbol, toIso(rangeFrom), toIso(rangeTo), "1");
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
            setChartError("No historical data returned for this symbol.");
          }
        }
      } catch (err) {
        console.error("Failed to fetch historical data", err);
        if (!isMounted) return;
        setHistoricalData([]);
        setChartError(formatApiError(err) || "Failed to load historical data.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchHistorical();

    return () => { isMounted = false; };
  }, [symbol]);

  // Heatmap Data Preparation
  const heatmapData = useMemo(() => {
    if (instruments.length === 0) return [];
    
    const map = new Map<number, { ceOI: number; peOI: number }>();
    instruments.forEach((inst) => {
      if (!inst.strike) return;
      if (!map.has(inst.strike)) map.set(inst.strike, { ceOI: 0, peOI: 0 });
      const group = map.get(inst.strike)!;
      
      const tick = getTick(inst.trading_symbol);
      if (tick) {
        if (inst.option_type === "CE") group.ceOI = tick.open_interest;
        if (inst.option_type === "PE") group.peOI = tick.open_interest;
      }
    });

    return Array.from(map.entries())
      .map(([strike, data]) => ({ strike, ceValue: data.ceOI, peValue: data.peOI }))
      .sort((a, b) => a.strike - b.strike);
  }, [instruments, getTick]); // Recalculate when new ticks arrive

  // Underlying tick for live chart updates
  const underlyingTick = getTick(symbol);
  const liveChartTick = underlyingTick ? { price: underlyingTick.last_price, timestamp: underlyingTick.timestamp } : null;

  return (
    <DashboardLayout>
      <PageContainer>
        <SectionHeader title="Advanced Charting" description="Historical OHLCV, live overlays, and heatmaps." />

        {/* Controls */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />

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

        {/* Main Chart Area */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          <div className="col-span-1 lg:col-span-2">
            {loading ? (
              <Card>
                <LoadingState size="lg" label="Loading chart data..." />
              </Card>
            ) : chartError ? (
              <Card className="flex flex-col gap-3">
                <EmptyState title="Failed to load chart data" />
                <ApiErrorDisplay error={chartError} />
              </Card>
            ) : (
              <TradingChart
                data={historicalData}
                liveTick={liveChartTick}
                indicators={indicators}
                symbol={symbol}
              />
            )}
          </div>

          <div className="col-span-1">
            {expiry ? (
              <div className="h-full max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                 <Heatmap data={heatmapData} title={`Open Interest Heatmap (${expiry})`} type="oi" />
              </div>
            ) : (
              <Card className="flex h-full items-center justify-center">
                <EmptyState title="Select an expiry date to view the strike-level heatmaps for this instrument." />
              </Card>
            )}
          </div>

        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
