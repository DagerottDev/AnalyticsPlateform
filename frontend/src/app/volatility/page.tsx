"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments } from "@/lib/market";
import { getHistoricalVolatility, getVolatilityMetrics, VolatilityHistoricalData, VolatilityMetrics } from "@/lib/volatility";
import { calculateImpliedVolatility } from "@/lib/greeks";
import { timeToExpiry, nearestStrikeTo, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
import { Instrument } from "@/types/market";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Tabs } from "@/components/ui/Tabs";
import { Activity, History } from "lucide-react";

// Components
import { IVSmileChart } from "@/components/volatility/IVSmileChart";
import { TermStructureChart } from "@/components/volatility/TermStructureChart";
import { HistoricalVolChart } from "@/components/volatility/HistoricalVolChart";
import { IVSurfaceHeatmap } from "@/components/volatility/IVSurfaceHeatmap";

const TABS = [
  { id: "live", label: "Live Volatility", icon: Activity },
  { id: "historical", label: "Historical Analysis", icon: History },
];

export default function VolatilityPage() {
  const [activeTab, setActiveTab] = useState<string>("live");
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  
  // Historical State
  const [histData, setHistData] = useState<VolatilityHistoricalData[]>([]);
  const [metrics, setMetrics] = useState<VolatilityMetrics | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  // Live Options State
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const { getTick } = useMarketData(allSymbols);

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
          const expiries = Array.from(
            new Set(data.instruments.map(i => i.expiry).filter((e): e is string => !!e))
          ).sort();
          if (!expiry && expiries.length > 0) {
            setExpiry(expiries[0]);
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
  const S = underlyingTick?.last_price || defaultSpotFallback(symbol);
  const r = DEFAULT_RISK_FREE_RATE;

  // Calculate live IVs for all fetched instruments based on live ticks
  const liveIVData = useMemo(() => {
    return instruments.map(inst => {
      const tick = getTick(inst.trading_symbol);
      let iv = 0;
      if (tick && tick.last_price > 0 && inst.strike && inst.expiry && inst.option_type) {
        const T = timeToExpiry(inst.expiry);
        iv = calculateImpliedVolatility(inst.option_type, S, inst.strike, T, r, tick.last_price);
      }
      return { ...inst, iv };
    });
  }, [instruments, getTick, S, r]);

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

    const atmStrike = nearestStrikeTo(strikes, S);
    
    const expiries = Array.from(
      new Set(instruments.map(i => i.expiry).filter((e): e is string => !!e))
    ).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    
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
      <PageContainer>
        <SectionHeader
          title="Volatility Analytics"
          description="IV Rank, Skew, Term Structure, and Historical Surface."
        />

        {/* Instrument controls — apply to both tabs below */}
        <Card>
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />
        </Card>

        <Tabs tabs={TABS} value={activeTab} onChange={setActiveTab} />

        {activeTab === "live" && (
          <>
            {/* Live Volatility Charts — derived from the current live tick/instrument snapshot */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <IVSmileChart data={smileData} />
              <TermStructureChart data={termStructureData} />
            </div>
            <IVSurfaceHeatmap data={surfaceData} />
          </>
        )}

        {activeTab === "historical" && (
          <>
            {/* Metrics derived from 1Y of daily historical IV/RV data */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {loadingHist ? (
                [0, 1, 2].map((i) => (
                  <Card key={i}>
                    <div className="h-3 w-20 animate-pulse rounded bg-[var(--color-bg-hover)]" />
                    <div className="mt-3 h-7 w-16 animate-pulse rounded bg-[var(--color-bg-hover)]" />
                  </Card>
                ))
              ) : metrics ? (
                <>
                  <Card>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Current IV
                    </p>
                    <p className="tnum mt-2 text-2xl font-black text-[var(--color-accent-blue)]">
                      {(metrics.current_iv * 100).toFixed(1)}%
                    </p>
                  </Card>
                  <Card>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      IV Rank (IVR)
                    </p>
                    <p className="tnum mt-2 text-2xl font-black text-[var(--color-accent-purple)]">
                      {metrics.iv_rank.toFixed(1)}
                    </p>
                  </Card>
                  <Card>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      IV Percentile
                    </p>
                    <p className="tnum mt-2 text-2xl font-black text-[var(--color-text-bright)]">
                      {metrics.iv_percentile.toFixed(1)}%
                    </p>
                  </Card>
                </>
              ) : null}
            </div>
            {metrics && (
              <p className="text-center text-[10px] text-[var(--color-text-muted)]">
                Based on 1Y historical data ({metrics.data_points} days)
              </p>
            )}

            <HistoricalVolChart data={histData} />
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
