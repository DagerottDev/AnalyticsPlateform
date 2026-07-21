"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments } from "@/lib/market";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { 
  getLotSize, 
  calculateContractGEX, 
  calculateContractVannaExposure, 
  calculateContractCharmExposure,
  calculateZeroGamma,
  findGammaWalls,
  StrikeExposure
} from "@/lib/dealerFlow";
import { Instrument } from "@/types/market";
import { StatTile } from "@/components/ui/StatTile";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";

// Components
import { GEXProfileChart } from "@/components/dealer-flow/GEXProfileChart";
import { ExposureChart } from "@/components/dealer-flow/ExposureChart";

export default function DealerFlowPage() {
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const tradingSymbols = useMemo(() => instruments.map((i) => i.trading_symbol), [instruments]);
  const { getTick } = useMarketData([...tradingSymbols, symbol]);

  // Load Contracts
  useEffect(() => {
    let isMounted = true;
    if (!symbol) return;

    async function fetchContracts() {
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          setInstruments(data.instruments);
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
  }, [symbol]); // Deliberately let it re-run when symbol changes

  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || (symbol === "NIFTY" ? 22000 : 48000);
  const r = 0.10;
  const lotSize = getLotSize(symbol);

  // Calculate live exposures for the selected expiry
  const exposures = useMemo(() => {
    if (!expiry || instruments.length === 0) return { gex: [], vanna: [], charm: [] };

    const currentExpiryInts = instruments.filter(i => i.expiry === expiry && i.strike && i.option_type);
    
    // T Calculation
    const expDate = new Date(expiry);
    expDate.setHours(15, 30, 0, 0);
    const diffDays = (expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    const T = Math.max(diffDays / 365, 0.0001);

    const strikeMap = new Map<number, { 
      ceGex: number; peGex: number; 
      ceVanna: number; peVanna: number;
      ceCharm: number; peCharm: number;
    }>();

    currentExpiryInts.forEach(inst => {
      const tick = getTick(inst.trading_symbol);
      if (!tick || !inst.strike) return;

      // Need IV to get Greeks
      const optionType = inst.option_type as "CE" | "PE";
      const iv = calculateImpliedVolatility(optionType, S, inst.strike, T, r, tick.last_price);
      if (iv === 0) return;

      const greeks = calculateGreeks(optionType, S, inst.strike, T, r, iv);
      const oi = tick.open_interest || 0;

      // Exposures
      const gex = calculateContractGEX(greeks.gamma, oi, S, lotSize, inst.option_type as "CE"|"PE");
      const vannaExp = calculateContractVannaExposure(greeks.vanna, oi, S, lotSize, inst.option_type as "CE"|"PE");
      const charmExp = calculateContractCharmExposure(greeks.charm, oi, lotSize, inst.option_type as "CE"|"PE");

      if (!strikeMap.has(inst.strike)) {
        strikeMap.set(inst.strike, { ceGex: 0, peGex: 0, ceVanna: 0, peVanna: 0, ceCharm: 0, peCharm: 0 });
      }
      
      const group = strikeMap.get(inst.strike)!;
      if (inst.option_type === "CE") {
        group.ceGex = gex; group.ceVanna = vannaExp; group.ceCharm = charmExp;
      } else {
        group.peGex = gex; group.peVanna = vannaExp; group.peCharm = charmExp;
      }
    });

    const gexProfile: StrikeExposure[] = [];
    const vannaProfile: StrikeExposure[] = [];
    const charmProfile: StrikeExposure[] = [];

    Array.from(strikeMap.entries()).forEach(([strike, data]) => {
      gexProfile.push({ strike, callExposure: data.ceGex, putExposure: data.peGex, totalExposure: data.ceGex + data.peGex });
      vannaProfile.push({ strike, callExposure: data.ceVanna, putExposure: data.peVanna, totalExposure: data.ceVanna + data.peVanna });
      charmProfile.push({ strike, callExposure: data.ceCharm, putExposure: data.peCharm, totalExposure: data.ceCharm + data.peCharm });
    });

    return {
      gex: gexProfile.sort((a, b) => a.strike - b.strike),
      vanna: vannaProfile.sort((a, b) => a.strike - b.strike),
      charm: charmProfile.sort((a, b) => a.strike - b.strike)
    };

  }, [instruments, expiry, getTick, S, lotSize]);

  // Top level metrics
  const totalCallGex = exposures.gex.reduce((sum, item) => sum + item.callExposure, 0);
  const totalPutGex = exposures.gex.reduce((sum, item) => sum + item.putExposure, 0);
  const netGex = totalCallGex + totalPutGex;
  const pcGammaRatio = totalCallGex !== 0 ? Math.abs(totalPutGex / totalCallGex) : 0;
  
  const zeroGamma = calculateZeroGamma(exposures.gex);
  const { callWall, putWall } = findGammaWalls(exposures.gex);

  return (
    <DashboardLayout>
      <PageContainer>
        <SectionHeader
          title="Dealer Flow"
          description="Gamma Exposure (GEX), Zero Gamma, and Sticky Walls."
        />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatTile
            label="Total Net GEX"
            value={`${(netGex / 1000000000).toFixed(2)}B`}
            tone={netGex > 0 ? "profit" : "loss"}
          />
          <StatTile label="Zero Gamma" value={zeroGamma || "-"} />
          <StatTile label="Call Wall" value={callWall || "-"} tone="profit" />
          <StatTile label="Put Wall" value={putWall || "-"} tone="loss" />
          <StatTile label="P/C Gamma Ratio" value={pcGammaRatio.toFixed(2)} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="col-span-1 lg:col-span-3">
            <GEXProfileChart data={exposures.gex} spotPrice={S} />
          </div>

          <div className="col-span-1 lg:col-span-1">
             <ExposureChart title="Vanna Exposure (Δ Delta / 1% Δ IV)" data={exposures.vanna} spotPrice={S} />
          </div>

          <div className="col-span-1 lg:col-span-2">
             <ExposureChart title="Charm Exposure (Δ Delta / 1 Day Decay)" data={exposures.charm} spotPrice={S} />
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
