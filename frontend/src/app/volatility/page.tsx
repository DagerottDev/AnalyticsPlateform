"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments } from "@/lib/market";
import { getHistoricalVolatility, getVolatilityMetrics, VolatilityHistoricalData, VolatilityMetrics } from "@/lib/volatility";
import { calculateImpliedVolatility } from "@/lib/greeks";
import { fitSvi, sviImpliedVolatility } from "@/lib/svi";
import { timeToExpiry, nearestStrikeTo, defaultSpotFallback, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
import { Instrument } from "@/types/market";
import { useSettingsStore } from "@/stores/settingsStore";
import { Card } from "@/components/ui/Card";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Tabs } from "@/components/ui/Tabs";
import { ApiErrorDisplay } from "@/components/ui/ApiErrorDisplay";
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
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [expiry, setExpiry] = useState<string | null>(null);
  
  // Historical State
  const [histData, setHistData] = useState<VolatilityHistoricalData[]>([]);
  const [metrics, setMetrics] = useState<VolatilityMetrics | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [histError, setHistError] = useState<unknown>(null);

  // Live Options State
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const { getTick } = useMarketData(allSymbols);

  // Load Historical Volatility
  useEffect(() => {
    let isMounted = true;
    // Historical daily data is expensive and broker-rate-limited. Defer it
    // until the user opens this tab instead of firing it on every visit to
    // the live-volatility view.
    if (!symbol || activeTab !== "historical") return;

    async function fetchHistorical() {
      setLoadingHist(true);
      setHistError(null);
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
        if (isMounted) {
          setHistData([]);
          setMetrics(null);
          setHistError(err);
        }
      } finally {
        if (isMounted) setLoadingHist(false);
      }
    }
    fetchHistorical();
    return () => { isMounted = false; };
  }, [symbol, activeTab]);

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

  // Fit a constrained SVI total-variance smile per expiry. This replaces the
  // old raw call/put interpolation with a smooth parametric surface.
  const sviByExpiry = useMemo(() => {
    const models = new Map<string, ReturnType<typeof fitSvi>>();
    const expiries = Array.from(new Set(liveIVData.map(item => item.expiry).filter((value): value is string => !!value)));
    expiries.forEach(exp => {
      const byStrike = new Map<number, number[]>();
      liveIVData.filter(item => item.expiry === exp && item.strike && item.iv > 0).forEach(item => {
        byStrike.set(item.strike!, [...(byStrike.get(item.strike!) || []), item.iv]);
      });
      const points = Array.from(byStrike, ([strike, values]) => ({ strike, iv: values.reduce((sum, value) => sum + value, 0) / values.length }));
      models.set(exp, fitSvi(points, S, timeToExpiry(exp)));
    });
    return models;
  }, [liveIVData, S]);

  // Smile Data (fitted SVI values when calibration passes quality checks)
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

    const model = sviByExpiry.get(expiry);
    const T = timeToExpiry(expiry);
    return Array.from(map.entries())
      .map(([strike, data]) => {
        const fitted = model ? sviImpliedVolatility(model, strike, S, T) : 0;
        return { strike, ceIV: fitted || data.ceIV, peIV: fitted || data.peIV };
      })
      .sort((a, b) => a.strike - b.strike);
  }, [liveIVData, expiry, sviByExpiry, S]);

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

  // Surface Data from each expiry's calibrated SVI smile, with raw values as
  // a deliberate fallback for sparse/invalid broker snapshots.
  const surfaceData = useMemo(() => {
    const map = new Map<string, number>(); // key: expiry_strike -> average IV
    
    liveIVData.forEach(inst => {
      if (!inst.strike) return;
      const key = `${inst.expiry}_${inst.strike}`;
      const existing = map.get(key) || 0;
      
      map.set(key, existing === 0 ? inst.iv : (existing + inst.iv) / 2);
    });

    const result = [];
    for (const [key, iv] of map.entries()) {
      const [exp, strStr] = key.split("_");
      const strike = parseInt(strStr);
      const model = sviByExpiry.get(exp);
      const fitted = model ? sviImpliedVolatility(model, strike, S, timeToExpiry(exp)) : 0;
      result.push({ expiry: exp, strike, iv: fitted || iv });
    }
    return result;
  }, [liveIVData, sviByExpiry, S]);

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
            {histError && <ApiErrorDisplay error={histError} />}

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
