"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TradingChart } from "@/components/charts/TradingChart";
import { Heatmap } from "@/components/charts/Heatmap";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { apiClient } from "@/lib/api";
import { OHLCVData } from "@/lib/indicators";
import { Instrument } from "@/types/market";
import { getInstruments } from "@/lib/market";
import { Loader2 } from "lucide-react";

export default function ChartsPage() {
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  
  const [historicalData, setHistoricalData] = useState<OHLCVData[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [indicators, setIndicators] = useState({ sma: false, ema: false, bbands: false, rsi: false, supertrend: false });
  
  // For Heatmap
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const { getTick } = useMarketData([...tradingSymbols, symbol]); // Subscribe to options + underlying

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
      try {
        // Fetch historical data from backend
        // Defaulting to base symbol for the main chart
        const response = await apiClient.get(`/historical/ohlcv/${symbol}`);
        if (isMounted) {
          // Response is expected to be array of OHLCV
          if (Array.isArray(response.data) && response.data.length > 0) {
            const formatted = response.data.map((item: {
              timestamp: string;
              open: number;
              high: number;
              low: number;
              close: number;
              volume: number;
            }) => ({
              time: item.timestamp,
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              volume: item.volume
            }));
            setHistoricalData(formatted);
          } else {
             // Mock data if backend empty
             generateMockData();
          }
        }
      } catch (err) {
        console.error("Failed to fetch historical data", err);
        if (isMounted) generateMockData();
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    const generateMockData = () => {
      // Generate realistic mock data for UI testing
      const data: OHLCVData[] = [];
      let currentPrice = symbol === "NIFTY" ? 22000 : 48000;
      const currentTime = new Date();
      currentTime.setHours(9, 15, 0, 0); // Market open

      for (let i = 0; i < 375; i++) { // 1 minute candles for a trading day
        const volatility = currentPrice * 0.001;
        const open = currentPrice;
        const close = open + (Math.random() - 0.5) * volatility;
        const high = Math.max(open, close) + Math.random() * volatility * 0.5;
        const low = Math.min(open, close) - Math.random() * volatility * 0.5;
        const volume = Math.floor(Math.random() * 10000) + 1000;

        data.push({
          time: new Date(currentTime).getTime() / 1000,
          open, high, low, close, volume
        });

        currentPrice = close;
        currentTime.setMinutes(currentTime.getMinutes() + 1);
      }
      setHistoricalData(data);
    };

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
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-bright)]">Advanced Charting</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Historical OHLCV, live overlays, and heatmaps.</p>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />
          
          <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-2 shadow-sm">
            <span className="px-2 text-xs font-semibold text-[var(--color-text-secondary)]">Indicators:</span>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-text-bright)]">
              <input type="checkbox" checked={indicators.sma} onChange={() => setIndicators(s => ({...s, sma: !s.sma}))} className="accent-[var(--color-accent-blue)]" /> SMA
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-text-bright)]">
              <input type="checkbox" checked={indicators.ema} onChange={() => setIndicators(s => ({...s, ema: !s.ema}))} className="accent-[var(--color-accent-blue)]" /> EMA
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-text-bright)]">
              <input type="checkbox" checked={indicators.bbands} onChange={() => setIndicators(s => ({...s, bbands: !s.bbands}))} className="accent-[var(--color-accent-blue)]" /> Bollinger
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-text-bright)]">
              <input type="checkbox" checked={indicators.rsi} onChange={() => setIndicators(s => ({...s, rsi: !s.rsi}))} className="accent-[var(--color-accent-blue)]" /> RSI
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-text-bright)]">
              <input type="checkbox" checked={indicators.supertrend} onChange={() => setIndicators(s => ({...s, supertrend: !s.supertrend}))} className="accent-[var(--color-accent-blue)]" /> Supertrend
            </label>
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          
          <div className="col-span-1 lg:col-span-2">
            {loading ? (
              <div className="flex h-[400px] items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent-blue)]" />
              </div>
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
              <div className="flex h-full items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm text-[var(--color-text-muted)] p-6 text-center">
                Select an expiry date to view the strike-level heatmaps for this instrument.
              </div>
            )}
          </div>
          
        </div>

      </div>
    </DashboardLayout>
  );
}
