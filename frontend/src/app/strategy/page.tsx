"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments, getMarginRequirement, MarginResult } from "@/lib/market";
import { calculateImpliedVolatility } from "@/lib/greeks";
import { timeToExpiry, defaultSpotFallback } from "@/lib/optionMath";
import {
  StrategyLeg,
  calculatePayoffProfile,
  calculateNetGreeks,
  deriveMetricsFromProfile
} from "@/lib/strategy";
import { Instrument } from "@/types/market";
import { usePositionStore } from "@/stores/positionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAuth } from "@/hooks/useAuth";
import { createPaperOrder } from "@/lib/paperTrading";
import { simulateStrategyPnl } from "@/lib/monteCarlo";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { Briefcase, Calculator, FlaskConical, Loader2 } from "lucide-react";

// Components
import { LegManager } from "@/components/strategy-builder/LegManager";
import { PayoffChart } from "@/components/strategy-builder/PayoffChart";
import { StrategyMetrics } from "@/components/strategy-builder/StrategyMetrics";
import { MonteCarloPanel } from "@/components/strategy-builder/MonteCarloPanel";
import { StrategyBacktestPanel } from "@/components/strategy-builder/StrategyBacktestPanel";
import { parseStrategyBasket } from "@/lib/basket";

function StrategyBuilderContent() {
  const searchParams = useSearchParams();
  const basketSeeded = useRef(false);
  const executePaperOrder = usePositionStore((state) => state.executePaperOrder);
  const { tradingMode } = useAuth();

  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const strategyPreferences = useSettingsStore((state) => state.strategy);
  const riskFreeRate = useSettingsStore((state) => (
    (state.analytics.riskFreeRatePercent[symbol] ?? state.analytics.riskFreeRatePercent.DEFAULT ?? 10) / 100
  ));
  const [expiry, setExpiry] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const incomingBasket = useMemo(() => parseStrategyBasket(searchParams.get("basket")), [searchParams]);

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
          if (!basketSeeded.current && incomingBasket.length > 0) {
            const hydrated = incomingBasket.flatMap((seed, index) => {
              const instrument = data.instruments.find(item => item.trading_symbol === seed.s);
              return instrument ? [{
                id: `basket-${index}-${seed.s}`,
                instrument,
                action: seed.a,
                quantity: seed.q,
                entryPrice: seed.p,
                iv: 0.15,
              }] : [];
            });
            if (hydrated.length > 0) {
              setLegs(hydrated);
              const seededExpiry = hydrated[0].instrument.expiry;
              if (seededExpiry) setExpiry(seededExpiry);
            }
            basketSeeded.current = true;
          } else if (!basketSeeded.current) {
            // Reset legs only for an ordinary symbol change, never after the
            // new-window basket handoff has populated them.
            setLegs([]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol, incomingBasket]);

  // Live Calculations
  const underlyingTick = getTick(symbol);
  const spotPrice = underlyingTick?.last_price || defaultSpotFallback(symbol);
  // Sourced live from the broker's symbol master via the instruments fetch
  // above (see backend's lot_size_store), not a hardcoded per-symbol table —
  // 0 until that fetch resolves, which the leg UI treats as "not ready yet".
  const lotSize = instruments[0]?.lot_size ?? 0;

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
        const T = timeToExpiry(leg.instrument.expiry);

        const iv = calculateImpliedVolatility(
          leg.instrument.option_type as "CE"|"PE",
          spotPrice,
          leg.instrument.strike!,
          T,
          riskFreeRate,
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
  }, [getTick, riskFreeRate, spotPrice]); // Depends on ticks arriving

  // Derive Strategy Data
  const payoffData = useMemo(() => {
    return calculatePayoffProfile(legs, spotPrice, riskFreeRate, 0.10, 100);
  }, [legs, riskFreeRate, spotPrice]);

  const profileMetrics = useMemo(() => {
    return deriveMetricsFromProfile(payoffData);
  }, [payoffData]);

  const netGreeks = useMemo(() => {
    return calculateNetGreeks(legs, spotPrice, 0.10, riskFreeRate);
  }, [legs, riskFreeRate, spotPrice]);

  const totalCost = useMemo(() => {
    return legs.reduce((sum, leg) => {
      const sign = leg.action === "Buy" ? 1 : -1;
      return sum + (leg.entryPrice * leg.quantity * sign);
    }, 0);
  }, [legs]);
  const simulation = useMemo(() => simulateStrategyPnl(legs, spotPrice, 2000, Date.now(), riskFreeRate), [legs, riskFreeRate, spotPrice]);

  const validLegs = legs.filter(l => l.instrument !== null);

  const [marginResult, setMarginResult] = useState<MarginResult | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [marginError, setMarginError] = useState<string | null>(null);

  // Reset any previously-fetched margin once the legs change — it's a
  // point-in-time broker quote, not something that should keep being shown
  // (and implicitly trusted) against a strategy that's since been edited.
  useEffect(() => {
    setMarginResult(null);
    setMarginError(null);
  }, [legs]);

  const handleCheckMargin = async () => {
    if (validLegs.length === 0) return;
    setMarginLoading(true);
    setMarginError(null);
    try {
      const result = await getMarginRequirement(
        validLegs.map(leg => ({
          symbol: leg.instrument!.trading_symbol,
          quantity: leg.quantity,
          side: leg.action,
        }))
      );
      setMarginResult(result);
    } catch {
      setMarginError("Failed to fetch margin — check your broker session.");
    } finally {
      setMarginLoading(false);
    }
  };

  const handlePaperTrade = () => {
    if (tradingMode !== "paper" || validLegs.length === 0) return;

    try {
      const order = createPaperOrder(
        validLegs,
        (tradingSymbol) => getTick(tradingSymbol)?.last_price
      );
      executePaperOrder({
        symbol,
        label: `${symbol} • ${order.legs.length} leg${order.legs.length > 1 ? "s" : ""}`,
        legs: order.legs,
        entryCost: order.entryCost,
        fills: order.fills,
      });
      toast.success("Paper order filled", {
        description: `${order.fills.length} leg${order.fills.length === 1 ? "" : "s"} filled at the latest quoted premium.`,
      });
    } catch (error) {
      toast.error("Paper order was not filled", {
        description: error instanceof Error ? error.message : "Unable to obtain a live fill price.",
      });
    }
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <div className="flex items-center justify-between gap-4">
          <SectionHeader
            title="Strategy Builder"
            description="Construct multi-leg strategies, visualize risk, and simulate filled paper trades."
          />
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={tradingMode === "paper" ? "blue" : "orange"}>
              {tradingMode === "paper" ? "Paper mode" : "Live mode"}
            </Badge>
            <Button
              variant="secondary"
              onClick={handleCheckMargin}
              disabled={validLegs.length === 0 || marginLoading}
            >
              {marginLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              Check Margin
            </Button>
            <Button
              onClick={handlePaperTrade}
              disabled={tradingMode !== "paper" || validLegs.length === 0}
              title={tradingMode === "paper" ? "Fill each leg at its latest quoted price" : "Switch to Paper mode to simulate this strategy"}
            >
              {tradingMode === "paper" ? <FlaskConical className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
              {tradingMode === "paper" ? "Execute Paper Trade" : "Live execution unavailable"}
            </Button>
          </div>
        </div>

        <Card className="p-3">
          <InstrumentSelector
            symbol={symbol}
            onSymbolChange={setSymbol}
            expiry={expiry}
            onExpiryChange={setExpiry}
          />
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          <div className="flex flex-col gap-6 lg:col-span-1">
            <LegManager
              legs={legs}
              onChange={setLegs}
              availableInstruments={instruments}
              currentExpiry={expiry}
              lotSize={lotSize}
              spot={spotPrice}
              defaultPreset={strategyPreferences.defaultPreset}
            />
          </div>

          <div className="flex flex-col gap-6 lg:col-span-2">
            {(marginResult || marginError) && (
              <Card className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <Calculator className="h-3.5 w-3.5" /> Margin Required
                </h3>
                {marginError ? (
                  <p className="text-sm text-[var(--color-loss)]">{marginError}</p>
                ) : marginResult ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <div className="text-xs font-medium text-[var(--color-text-secondary)]">Total Margin</div>
                      <div className="tnum mt-1 text-lg font-bold text-[var(--color-text-bright)]">
                        {marginResult.total_margin !== null ? marginResult.total_margin.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-[var(--color-text-secondary)]">Span</div>
                      <div className="tnum mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                        {marginResult.span_margin !== null ? marginResult.span_margin.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-[var(--color-text-secondary)]">Exposure</div>
                      <div className="tnum mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                        {marginResult.exposure_margin !== null ? marginResult.exposure_margin.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-[var(--color-text-secondary)]">Available</div>
                      <div className="tnum mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
                        {marginResult.available_margin !== null ? marginResult.available_margin.toFixed(2) : "—"}
                      </div>
                    </div>
                  </div>
                ) : null}
              </Card>
            )}
            <StrategyMetrics metrics={profileMetrics} netGreeks={netGreeks} cost={totalCost} />
            <MonteCarloPanel result={simulation} />
            <StrategyBacktestPanel symbol={symbol} currentSpot={spotPrice} legs={legs} defaultHoldingDays={strategyPreferences.backtestHoldingDays} defaultDaysToExpiry={strategyPreferences.backtestDaysToExpiry} />
            <PayoffChart data={payoffData} currentSpot={spotPrice} />
          </div>

        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

export default function StrategyBuilderPage() {
  return <Suspense fallback={<div className="p-8 text-sm text-[var(--color-text-muted)]">Loading strategy builder…</div>}><StrategyBuilderContent /></Suspense>;
}
