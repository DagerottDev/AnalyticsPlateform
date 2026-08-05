"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { BookOpen } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { InstrumentSelector } from "@/components/market/InstrumentSelector";
import { useMarketData } from "@/hooks/useMarketData";
import { getInstruments, getMarketQuotes } from "@/lib/market";
import { calculateGreeks, calculateImpliedVolatility } from "@/lib/greeks";
import { timeToExpiry, defaultSpotFallback } from "@/lib/optionMath";
import { nearestExpiry } from "@/lib/expiry";
import { toClosedMarketQuote } from "@/lib/marketTick";
import { useNseMarketSession } from "@/hooks/useNseMarketSession";
import {
  calculateContractGEX,
  calculateContractVannaExposure, 
  calculateContractCharmExposure,
  calculateZeroGamma,
  findGammaWalls,
  resolveOpenInterest,
  StrikeExposure
} from "@/lib/dealerFlow";
import { Instrument, MarketTick } from "@/types/market";
import { useSettingsStore } from "@/stores/settingsStore";
import { StatTile } from "@/components/ui/StatTile";
import { PageContainer } from "@/components/ui/PageContainer";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { EducationPopover } from "@/components/ui/EducationPopover";

// Components
import { GEXProfileChart } from "@/components/dealer-flow/GEXProfileChart";
import { ExposureChart } from "@/components/dealer-flow/ExposureChart";
import { DealerFlowEducationAside } from "@/components/dealer-flow/DealerFlowEducationAside";

const DEALER_FLOW_REFERENCE = "https://www.optionseducation.org/advancedconcepts/understanding-options-greeks";
const GREEKS_REFERENCE = "https://www.optionseducation.org/advancedconcepts/volatility-the-greeks";

export default function DealerFlowPage() {
  const [symbol, setSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const [educationOpen, setEducationOpen] = useState(false);
  const riskFreeRate = useSettingsStore((state) => (
    (state.analytics.riskFreeRatePercent[symbol] ?? state.analytics.riskFreeRatePercent.DEFAULT ?? 10) / 100
  ));
  const refreshMilliseconds = useSettingsStore((state) => state.charts.refreshSeconds * 1000);
  const marketSession = useNseMarketSession();
  const [expiry, setExpiry] = useState<string | null>(null);
  const selectedExpiryRef = useRef(expiry);

  useEffect(() => {
    selectedExpiryRef.current = expiry;
  }, [expiry]);
  
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [snapshotTicks, setSnapshotTicks] = useState<Record<string, MarketTick>>({});
  const tradingSymbols = useMemo(
    () => instruments.filter((instrument) => instrument.expiry === expiry).map((instrument) => instrument.trading_symbol),
    [instruments, expiry]
  );
  const allSymbols = useMemo(() => [...tradingSymbols, symbol], [tradingSymbols, symbol]);
  const allSymbolsKey = allSymbols.join(",");
  const { getTick: getLiveTick } = useMarketData(allSymbols);

  // WebSocket subscriptions pause outside regular hours. Dealer-flow still
  // needs a usable closing view, so fetch the broker's latest REST snapshot
  // for the selected expiry and normalize it to the broker's latest traded
  // prices.
  useEffect(() => {
    if (!symbol || !expiry || !allSymbolsKey || marketSession.state === "open") {
      setSnapshotTicks({});
      return;
    }

    let isMounted = true;
    let isFetching = false;
    const snapshotSymbols = allSymbolsKey.split(",").filter(Boolean);
    const snapshotInterval = Math.max(refreshMilliseconds, 15_000);

    async function fetchSnapshotQuotes() {
      if (isFetching) return;
      isFetching = true;
      try {
        const quotes: MarketTick[] = [];
        for (let index = 0; index < snapshotSymbols.length; index += 40) {
          const chunk = snapshotSymbols.slice(index, index + 40);
          try {
            const response = await getMarketQuotes(chunk);
            quotes.push(...response.quotes.map(toClosedMarketQuote));
          } catch {
            // Keep successful chunks and the previous snapshot when one broker
            // request is temporarily rate-limited or unavailable.
          }
        }
        if (!isMounted || quotes.length === 0) return;
        setSnapshotTicks((current) => ({
          ...current,
          ...Object.fromEntries(quotes.map((quote) => [quote.trading_symbol, quote])),
        }));
      } finally {
        isFetching = false;
      }
    }

    void fetchSnapshotQuotes();
    const interval = window.setInterval(() => void fetchSnapshotQuotes(), snapshotInterval);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [allSymbolsKey, expiry, marketSession.state, refreshMilliseconds, symbol]);

  const getTick = useCallback(
    (tradingSymbol: string): MarketTick | null => {
      const live = getLiveTick(tradingSymbol);
      const snapshot = snapshotTicks[tradingSymbol];
      if (marketSession.state !== "open") return snapshot ?? live ?? null;
      return live ?? snapshot ?? null;
    },
    [getLiveTick, marketSession.state, snapshotTicks]
  );

  // Load Contracts
  useEffect(() => {
    let isMounted = true;
    if (!symbol) return;

    async function fetchContracts() {
      try {
        const data = await getInstruments(symbol);
        if (isMounted) {
          setInstruments(data.instruments);
          const defaultExpiry = nearestExpiry(
            data.instruments.map((instrument) => instrument.expiry).filter((value): value is string => !!value)
          );
          if (!selectedExpiryRef.current && defaultExpiry) setExpiry(defaultExpiry);
        }
      } catch (err) {
        console.error("Failed to fetch instruments", err);
      }
    }
    fetchContracts();
    return () => { isMounted = false; };
  }, [symbol]);

  const underlyingTick = getTick(symbol);
  const S = underlyingTick?.last_price || defaultSpotFallback(symbol);
  const r = riskFreeRate;
  // Sourced live from the broker's symbol master via the instruments fetch
  // above (see backend's lot_size_store), not a hardcoded per-symbol table.
  const lotSize = instruments[0]?.lot_size ?? 0;

  // Calculate live exposures for the selected expiry
  const exposures = useMemo(() => {
    if (!expiry || instruments.length === 0) return { gex: [], vanna: [], charm: [] };

    const currentExpiryInts = instruments.filter(i => i.expiry === expiry && i.strike && i.option_type);

    const T = timeToExpiry(expiry);

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
      const oi = resolveOpenInterest(tick.open_interest, inst.oi);

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

  }, [instruments, expiry, getTick, S, lotSize, r]);

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <SectionHeader
              title="Dealer Flow"
              description="Gamma Exposure (GEX), Zero Gamma, and Sticky Walls."
            />
            <EducationPopover
              title="Dealer Flow analytics"
              description="This workspace estimates strike-level dealer hedging exposure from option open interest, implied volatility, and Black-Scholes Greeks for the selected underlying and expiry."
              tips={[
                "Use the nearest expiry for the most responsive positioning view.",
                "Positive and negative values are model sign conventions, not a guarantee of direction.",
                "Outside market hours, the page uses the broker's latest traded quote snapshot.",
              ]}
              links={[{ label: "OIC: Understanding option Greeks", href: DEALER_FLOW_REFERENCE }]}
            />
          </div>
          {!educationOpen && (
            <Button variant="outline" size="sm" onClick={() => setEducationOpen(true)}>
              <BookOpen className="h-4 w-4" /> Show education
            </Button>
          )}
        </div>

        <div className={educationOpen ? "grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]" : ""}>
          {educationOpen && <DealerFlowEducationAside onClose={() => setEducationOpen(false)} />}
          <div className="flex min-w-0 flex-col gap-4">
            {marketSession.state !== "open" ? (
              <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]" role="status">
                {marketSession.label} — showing the latest available broker quote snapshot. Live dealer-flow updates resume when the market opens.
              </div>
            ) : null}

            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <InstrumentSelector
                symbol={symbol}
                onSymbolChange={(s) => { setSymbol(s); setExpiry(null); }}
                expiry={expiry}
                onExpiryChange={setExpiry}
              />
              <EducationPopover
                title="Underlying and expiry selector"
                description="Choose the instrument and option expiry used for every exposure calculation on this page."
                tips={[
                  "The expiry determines which call and put open-interest rows are grouped by strike.",
                  "Changing the symbol or expiry rebuilds the profiles and wall levels.",
                ]}
                links={[{ label: "OIC: Options basics", href: DEALER_FLOW_REFERENCE }]}
              />
            </div>

            {/* Metrics Overview */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <StatTile
                label="Total Net GEX"
                value={`${(netGex / 1000000000).toFixed(2)}B`}
                tone={netGex > 0 ? "profit" : "loss"}
                education={<EducationPopover title="Total Net GEX" description="The sum of call and put gamma exposure across the selected expiry. It approximates how much underlying hedging pressure changes as spot moves." tips={["Positive and negative readings depend on the sign convention used here.", "Compare the value with the strike profile rather than reading it as a standalone forecast."]} links={[{ label: "OIC: Understanding gamma", href: DEALER_FLOW_REFERENCE }]} />}
              />
              <StatTile
                label="Zero Gamma"
                value={zeroGamma || "-"}
                education={<EducationPopover title="Zero Gamma" description="The strike whose aggregate net gamma exposure is closest to zero in the selected chain." tips={["It is a reference level, not necessarily an exact mathematical crossing.", "Watch for changes as spot, IV, OI, or expiry changes."]} links={[{ label: "OIC: Understanding gamma", href: DEALER_FLOW_REFERENCE }]} />}
              />
              <StatTile
                label="Call Wall"
                value={callWall || "-"}
                tone="profit"
                education={<EducationPopover title="Call Wall" description="The strike with the largest positive call-side gamma exposure in the selected expiry." tips={["It can act as a reference for where call-side hedging is concentrated.", "It is not a guaranteed resistance level or trade signal."]} links={[{ label: "OIC: Understanding gamma", href: DEALER_FLOW_REFERENCE }]} />}
              />
              <StatTile
                label="Put Wall"
                value={putWall || "-"}
                tone="loss"
                education={<EducationPopover title="Put Wall" description="The strike with the most negative put-side gamma exposure in the selected expiry." tips={["It can act as a reference for where put-side hedging is concentrated.", "Use the full profile and current spot context before interpreting it."]} links={[{ label: "OIC: Understanding gamma", href: DEALER_FLOW_REFERENCE }]} />}
              />
              <StatTile
                label="P/C Gamma Ratio"
                value={pcGammaRatio.toFixed(2)}
                education={<EducationPopover title="Put/Call Gamma Ratio" description="The absolute put gamma exposure divided by call gamma exposure. A value above 1 means put-side magnitude is larger in this model." tips={["The ratio loses meaning when call exposure is near zero.", "Use it as a relative balance measure, not as a directional probability."]} links={[{ label: "OIC: Understanding option Greeks", href: DEALER_FLOW_REFERENCE }]} />}
              />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="col-span-1 lg:col-span-3">
                <GEXProfileChart
                  data={exposures.gex}
                  spotPrice={S}
                  education={<EducationPopover title="Gamma Exposure profile" description="Bars show call, put, and net gamma exposure by strike. The profile helps identify where modeled hedging pressure is concentrated." tips={["Compare the spot reference with the largest bars and the wall metrics above.", "The chart is based on the selected expiry and available OI snapshot."]} links={[{ label: "OIC: Understanding gamma", href: DEALER_FLOW_REFERENCE }]} />}
                />
              </div>

              <div className="col-span-1 lg:col-span-1">
                <ExposureChart
                  title="Vanna Exposure (Δ Delta / 1% Δ IV)"
                  data={exposures.vanna}
                  spotPrice={S}
                  education={<EducationPopover title="Vanna exposure" description="Vanna estimates how option delta changes when implied volatility changes. This view aggregates the selected expiry by strike." tips={["Large values indicate more sensitivity to an IV move.", "Vanna depends on spot, time, IV, and the option model inputs."]} links={[{ label: "OIC: Volatility and the Greeks", href: GREEKS_REFERENCE }]} />}
                />
              </div>

              <div className="col-span-1 lg:col-span-2">
                <ExposureChart
                  title="Charm Exposure (Δ Delta / 1 Day Decay)"
                  data={exposures.charm}
                  spotPrice={S}
                  education={<EducationPopover title="Charm exposure" description="Charm estimates how option delta changes as time passes, expressed here as one-day decay exposure by strike." tips={["Charm can change quickly near expiry.", "Use it alongside spot and IV rather than as an isolated signal."]} links={[{ label: "OIC: Volatility and the Greeks", href: GREEKS_REFERENCE }]} />}
                />
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
