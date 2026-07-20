"use client";

import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments } from "@/lib/market";
import { calculateImpliedVolatility } from "@/lib/greeks";
import { 
  StrategyLeg, 
  calculatePayoffProfile, 
  calculateNetGreeks, 
  deriveMetricsFromProfile 
} from "@/lib/strategy";
import { getLotSize } from "@/lib/dealerFlow";
import { Instrument } from "@/types/market";

// Components
import { LegManager } from "@/components/strategy-builder/LegManager";
import { PayoffChart } from "@/components/strategy-builder/PayoffChart";
import { StrategyMetrics } from "@/components/strategy-builder/StrategyMetrics";

export default function StrategyBuilderPage() {
  const [symbol, setSymbol] = useState<string>("NIFTY");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [legs, setLegs] = useState<StrategyLeg[]>([]);

  // Subscriptions
  const tradingSymbols = useMemo(() => {
    const syms = new Set<string>();
    syms.add(symbol); // Underlying
    legs.forEach(l => {
      if (l.instrument) syms.add(l.instrument.trading_symbol);
    });
    return Array.from(syms);
  }, [symbol, legs]);
  
  const { getTick } = useMarketData(tradingSymbols);

  // Load Contracts when symbol changes
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
          if (expiries.length > 0) {
            setExpiry(expiries[0]);
          }
          // Reset legs when symbol changes
          setLegs([]);
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol]);

  // Live Calculations
  const underlyingTick = getTick(symbol);
  const spotPrice = underlyingTick?.last_price || (symbol === "NIFTY" ? 22000 : 48000);
  const lotSize = getLotSize(symbol);

  // Auto-update Entry Prices and IV for legs based on live ticks if entryPrice is 0 (uninitialized)
  useEffect(() => {
    setLegs(currentLegs => {
      let changed = false;
      const updated = currentLegs.map(leg => {
        if (!leg.instrument) return leg;
        
        const tick = getTick(leg.instrument.trading_symbol);
        if (!tick || !leg.instrument.expiry || !leg.instrument.strike || !leg.instrument.option_type) return leg;

        const newLeg = { ...leg };

        // Auto-fill entry price if it's 0
        if (leg.entryPrice === 0 && tick.last_price > 0) {
          newLeg.entryPrice = tick.last_price;
          changed = true;
        }

        // Always update live IV for T+0 calculations
        const expDate = new Date(leg.instrument.expiry);
        expDate.setHours(15, 30, 0, 0);
        const diffDays = (expDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
        const T = Math.max(diffDays / 365, 0.0001);

        const iv = calculateImpliedVolatility(
          leg.instrument.option_type as "CE"|"PE",
          spotPrice,
          leg.instrument.strike!,
          T,
          0.10, // risk free rate
          tick.last_price
        );

        if (Math.abs(leg.iv - iv) > 0.01) { // 1% iv change threshold to avoid infinite re-renders
           newLeg.iv = iv;
           changed = true;
        }

        return newLeg;
      });
      
      return changed ? updated : currentLegs;
    });
  }, [getTick, spotPrice]); // Depends on ticks arriving

  // Derive Strategy Data
  const payoffData = useMemo(() => {
    return calculatePayoffProfile(legs, spotPrice, 0.10, 0.10, 100);
  }, [legs, spotPrice]);

  const profileMetrics = useMemo(() => {
    return deriveMetricsFromProfile(payoffData);
  }, [payoffData]);

  const netGreeks = useMemo(() => {
    return calculateNetGreeks(legs, spotPrice, 0.10);
  }, [legs, spotPrice]);

  const totalCost = useMemo(() => {
    return legs.reduce((sum, leg) => {
      const sign = leg.action === "Buy" ? 1 : -1;
      return sum + (leg.entryPrice * leg.quantity * sign);
    }, 0);
  }, [legs]);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-bright)]">Strategy Builder</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Construct multi-leg strategies and visualize risk profiles.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-1 flex flex-col gap-6">
            <LegManager 
              legs={legs}
              onChange={setLegs}
              availableInstruments={instruments}
              underlyingSymbol={symbol}
              onSymbolChange={setSymbol}
              currentExpiry={expiry}
              onExpiryChange={setExpiry}
              lotSize={lotSize}
              spot={spotPrice}
            />
          </div>

          <div className="lg:col-span-2 flex flex-col gap-6">
            <StrategyMetrics metrics={profileMetrics} netGreeks={netGreeks} cost={totalCost} />
            <PayoffChart data={payoffData} currentSpot={spotPrice} />
          </div>

        </div>

      </div>
    </DashboardLayout>
  );
}
