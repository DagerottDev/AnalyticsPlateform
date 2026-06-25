"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments } from "@/lib/market";
import { getHistoricalVolatility, getVolatilityMetrics, VolatilityHistoricalData, VolatilityMetrics } from "@/lib/volatility";
import { calculateImpliedVolatility } from "@/lib/greeks";
import { Instrument } from "@/types/market";
import { Loader2 } from "lucide-react";

// Components
import { IVSmileChart } from "@/components/volatility/IVSmileChart";
import { TermStructureChart } from "@/components/volatility/TermStructureChart";
import { HistoricalVolChart } from "@/components/volatility/HistoricalVolChart";
import { IVSurfaceHeatmap } from "@/components/volatility/IVSurfaceHeatmap";

export default function VolatilityPage() {
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  
  // Historical State
  const [histData, setHistData] = useState<VolatilityHistoricalData[]>([]);
  const [metrics, setMetrics] = useState<VolatilityMetrics | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  // Live Options State
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const { getTick } = useMarketData([...tradingSymbols, symbol]);

  // Load Historical Volatility
  useEffect(() => {
    let isMounted = true;
    if (!symbol) return;

    async function fetchHistorical() {
      setLoadingHist(true);
      try {
        const [hData, mData] = await Promise.all([
          getHistoricalVolatility(symbol),
          getVolatilityMetrics(symbol)
        ]);
        if (isMounted) {
          setHistData(hData);
          setMetrics(mData);
        }
      } catch (err) {
        console.error("Failed to fetch historical volatility", err);
      } finally {
        if (isMounted) setLoadingHist(false);
      }
    }
    fetchHistorical();
    return () => { isMounted = false; };
  }, [symbol]);

  // Load ALL expiries for this symbol to build term structure and surface
  useEffect(() => {
    let isMounted = true;
    if (!symbol) return;

    async function fetchContracts() {
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          setInstruments(data.instruments);
          // Set initial expiry if none selected
          if (!expiry && data.expiries.length > 0) {
            setExpiry(data.expiries[0]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol]); // Deliberately ignore expiry to load ALL contracts

  // Get underlying price
  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || (symbol === "NIFTY" ? 22000 : 48000);
  const r = 0.10; // 10% risk free

  // Calculate live IVs for all fetched instruments based on live ticks
  const liveIVData = useMemo(() => {
    return instruments.map(inst => {
      const tick = getTick(inst.trading_symbol);
      let iv = 0;
      if (tick && tick.last_price > 0 && inst.strike) {
        // Calculate T
        const expDate = new Date(inst.expiry);
        expDate.setHours(15, 30, 0, 0);
        const diffDays = (expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
        const T = Math.max(diffDays / 365, 0.0001);
        
        iv = calculateImpliedVolatility(inst.option_type, S, inst.strike, T, r, tick.last_price);
      }
      return { ...inst, iv };
    });
  }, [instruments, getTick, S]);

  // Smile Data (Filter by selected expiry)
  const smileData = useMemo(() => {
    if (!expiry) return [];
    
    const map = new Map<number, { ceIV: number; peIV: number }>();
    const currentExpiryInts = liveIVData.filter(i => i.expiry === expiry && i.strike);
    
    currentExpiryInts.forEach(inst => {
      if (!map.has(inst.strike!)) map.set(inst.strike!, { ceIV: 0, peIV: 0 });
      const group = map.get(inst.strike!)!;
      if (inst.option_type === "CE") group.ceIV = inst.iv;
      if (inst.option_type === "PE") group.peIV = inst.iv;
    });

    return Array.from(map.entries())
      .map(([strike, data]) => ({ strike, ceIV: data.ceIV, peIV: data.peIV }))
      .sort((a, b) => a.strike - b.strike);
  }, [liveIVData, expiry]);

  // Term Structure Data (ATM strikes across all expiries)
  const termStructureData = useMemo(() => {
    // Find closest strike to S
    const strikes = Array.from(new Set(instruments.map(i => i.strike).filter(Boolean))) as number[];
    if (strikes.length === 0) return [];
    
    const atmStrike = strikes.reduce((prev, curr) => Math.abs(curr - S) < Math.abs(prev - S) ? curr : prev);
    
    const expiries = Array.from(new Set(instruments.map(i => i.expiry))).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    
    return expiries.map(exp => {
      const atmCE = liveIVData.find(i => i.expiry === exp && i.strike === atmStrike && i.option_type === "CE");
      const atmPE = liveIVData.find(i => i.expiry === exp && i.strike === atmStrike && i.option_type === "PE");
      
      // Average IV of ATM Call and Put
      let atmIV = 0;
      if (atmCE?.iv && atmPE?.iv) {
        atmIV = (atmCE.iv + atmPE.iv) / 2;
      } else if (atmCE?.iv) {
        atmIV = atmCE.iv;
      } else if (atmPE?.iv) {
        atmIV = atmPE.iv;
      }

      return { expiry: exp, atmIV };
    });
  }, [instruments, liveIVData, S]);

  // Surface Data (All strikes, all expiries, average IV of CE/PE)
  const surfaceData = useMemo(() => {
    const map = new Map<string, number>(); // key: expiry_strike -> average IV
    
    liveIVData.forEach(inst => {
      if (!inst.strike) return;
      const key = `${inst.expiry}_${inst.strike}`;
      const existing = map.get(key) || 0;
      
      // Rough average for surface
      map.set(key, existing === 0 ? inst.iv : (existing + inst.iv) / 2);
    });

    const result = [];
    for (const [key, iv] of map.entries()) {
      const [exp, strStr] = key.split("_");
      result.push({ expiry: exp, strike: parseInt(strStr), iv });
    }
    return result;
  }, [liveIVData]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-bright)]">Volatility Analytics</h1>
          <p className="text-sm text-[var(--color-text-muted)]">IV Rank, Skew, Term Structure, and Historical Surface.</p>
        </div>

        {/* Top Controls & Metrics */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="col-span-1 flex flex-col gap-4">
            <InstrumentSelector 
              selectedSymbol={symbol} 
              onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }} 
              selectedExpiry={expiry} 
              onExpiryChange={setExpiry} 
            />
            
            {/* Metrics Cards */}
            {loadingHist ? (
              <div className="flex h-32 items-center justify-center rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent-blue)]" />
              </div>
            ) : metrics ? (
              <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 shadow-sm">
                <div className="flex justify-between items-center border-b border-[var(--color-border-subtle)] pb-2">
                  <span className="text-sm font-medium text-[var(--color-text-secondary)]">Current IV</span>
                  <span className="font-mono text-lg font-bold text-[var(--color-accent-blue)]">{(metrics.current_iv * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center border-b border-[var(--color-border-subtle)] pb-2">
                  <span className="text-sm font-medium text-[var(--color-text-secondary)]">IV Rank (IVR)</span>
                  <span className="font-mono text-lg font-bold text-[var(--color-accent-purple)]">{metrics.iv_rank.toFixed(1)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-[var(--color-text-secondary)]">IV Percentile</span>
                  <span className="font-mono text-lg font-bold text-[var(--color-text-bright)]">{metrics.iv_percentile.toFixed(1)}%</span>
                </div>
                <div className="text-[10px] text-center text-[var(--color-text-muted)] mt-1">
                  Based on 1Y historical data ({metrics.data_points} days)
                </div>
              </div>
            ) : null}
          </div>

          <div className="col-span-1 lg:col-span-3">
             <HistoricalVolChart data={histData} />
          </div>
        </div>

        {/* Live Volatility Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <IVSmileChart data={smileData} />
          <TermStructureChart data={termStructureData} />
        </div>

        {/* IV Surface */}
        <div>
          <IVSurfaceHeatmap data={surfaceData} />
        </div>

      </div>
    </DashboardLayout>
  );
}
