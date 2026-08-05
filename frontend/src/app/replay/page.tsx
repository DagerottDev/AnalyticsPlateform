"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useReplayStore } from "@/stores/replayStore";
import { buildReplaySession, enrichReplaySessionWithRealPrices, startPlayback, stopPlayback } from "@/lib/replayEngine";
import { getInstruments, getHistoricalCandles, getMarketQuotes } from "@/lib/market";
import { formatApiError } from "@/lib/apiError";
import { useSettingsStore } from "@/stores/settingsStore";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { History, PlayCircle, Settings2, AlertTriangle } from "lucide-react";
import type { Instrument } from "@/types/market";
import { defaultSpotFallback, nearestStrikeTo } from "@/lib/optionMath";
import { quoteLastPrice } from "@/lib/marketTick";
import { nearestExpiry, sortExpiries } from "@/lib/expiry";
import { formatStrikeWithPosition } from "@/lib/strikePositions";

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** True for Sat/Sun, parsed as a local calendar date (not UTC) so a
 * "YYYY-MM-DD" from a date input can't shift a day off under IST. */
function isWeekend(isoDate: string): boolean {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

// Used only when a contract has no broker price for the replay date. These
// conservative index-specific starting points are preferable to one fixed
// number (especially for the more volatile banking and mid-cap indices).
const DEFAULT_FALLBACK_IV_PERCENT: Record<string, number> = {
  NIFTY: 14,
  BANKNIFTY: 18,
  FINNIFTY: 17,
  MIDCPNIFTY: 20,
  SENSEX: 15,
};

export default function ReplayPage() {
  const {
    isActive,
    setIsActive,
    setIsPlaying,
    setSymbol,
    setSessionDate: setStoreSessionDate,
    setExpiry: setStoreExpiry,
    setStrike: setStoreStrike,
    setOptionSide: setStoreOptionSide,
    setReplayInstruments,
    setSpeedMultiplier,
    priceCoverage,
    setPriceCoverage,
    reset,
  } = useReplayStore();
  const replayPreferences = useSettingsStore((state) => state.replay);

  const [targetSymbol, setTargetSymbol] = useState<string>(() => useSettingsStore.getState().defaultSymbol);
  const riskFreeRate = useSettingsStore((state) => (
    (state.analytics.riskFreeRatePercent[targetSymbol] ?? state.analytics.riskFreeRatePercent.DEFAULT ?? 10) / 100
  ));
  const [availableInstruments, setAvailableInstruments] = useState<Instrument[]>([]);
  const [isLoadingInstruments, setIsLoadingInstruments] = useState(false);
  const [instrumentError, setInstrumentError] = useState<string | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [selectedStrike, setSelectedStrike] = useState("");
  const [marketSpot, setMarketSpot] = useState<number | null>(null);
  const [optionSide, setOptionSide] = useState<"BOTH" | "CE" | "PE">(() => replayPreferences.optionSide);
  const [sessionDate, setSessionDate] = useState(yesterday());
  const [resolution, setResolution] = useState(() => replayPreferences.resolution);
  const [fallbackIv, setFallbackIv] = useState(() => String(replayPreferences.fallbackIvPercent[useSettingsStore.getState().defaultSymbol] ?? replayPreferences.fallbackIvPercent.DEFAULT ?? DEFAULT_FALLBACK_IV_PERCENT[useSettingsStore.getState().defaultSymbol] ?? 15));
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Loading Historical Data...");
  const [error, setError] = useState<string | null>(null);
  const autoSelectedStrikeRef = useRef("");

  useEffect(() => {
    let mounted = true;
    setIsLoadingInstruments(true);
    setInstrumentError(null);
    setAvailableInstruments([]);
    setSelectedExpiry("");
    setSelectedStrike("");
    setMarketSpot(null);
    autoSelectedStrikeRef.current = "";

    getInstruments(targetSymbol)
      .then((response) => {
        if (!mounted) return;
        setAvailableInstruments(response.instruments);
        const defaultExpiry = nearestExpiry(
          response.instruments
            .map((instrument) => instrument.expiry)
            .filter((expiry): expiry is string => Boolean(expiry))
        );
        setSelectedExpiry(defaultExpiry ?? "");
      })
      .catch((cause) => {
        if (!mounted) return;
        setInstrumentError(formatApiError(cause) || "Failed to load option expiries and strikes.");
      })
      .finally(() => {
        if (mounted) setIsLoadingInstruments(false);
      });

    return () => {
      mounted = false;
    };
  }, [targetSymbol]);

  // A replay can be opened outside market hours, so use the broker's latest
  // quote to seed ATM when it is available and keep the symbol-specific
  // fallback for an offline/unauthenticated session. This is a single quote
  // request per underlying change and is independent of historical replay
  // requests.
  useEffect(() => {
    let mounted = true;

    async function fetchSpot() {
      try {
        const { quotes } = await getMarketQuotes([targetSymbol]);
        const quote = quotes.find((item) => item.trading_symbol === targetSymbol) ?? quotes[0];
        const latest = quoteLastPrice(quote);
        if (mounted && latest !== null) {
          setMarketSpot(latest);
        }
      } catch {
        // Instrument selection and replay remain usable with the safe
        // symbol-specific fallback when the quote endpoint is unavailable.
      }
    }

    void fetchSpot();
    return () => {
      mounted = false;
    };
  }, [targetSymbol]);

  useEffect(() => {
    setFallbackIv(String(replayPreferences.fallbackIvPercent[targetSymbol] ?? replayPreferences.fallbackIvPercent.DEFAULT ?? DEFAULT_FALLBACK_IV_PERCENT[targetSymbol] ?? 15));
  }, [replayPreferences.fallbackIvPercent, targetSymbol]);

  const expiries = useMemo(
    () => sortExpiries(
      availableInstruments
        .map((instrument) => instrument.expiry)
        .filter((value): value is string => Boolean(value))
    ),
    [availableInstruments]
  );

  const expiryInstruments = useMemo(
    () => availableInstruments.filter((instrument) => instrument.expiry === selectedExpiry),
    [availableInstruments, selectedExpiry]
  );

  const strikes = useMemo(
    () => Array.from(new Set(expiryInstruments.map((instrument) => instrument.strike).filter((value): value is number => value !== null)))
      .sort((a, b) => a - b),
    [expiryInstruments]
  );

  const strikeSpot = marketSpot ?? defaultSpotFallback(targetSymbol);
  const atmStrike = useMemo(
    () => strikes.length > 0 ? nearestStrikeTo(strikes, strikeSpot) : null,
    [strikes, strikeSpot]
  );

  useEffect(() => {
    if (strikes.length === 0 || atmStrike === null) {
      setSelectedStrike("");
      autoSelectedStrikeRef.current = "";
      return;
    }

    setSelectedStrike((current) => {
      // If the current value was chosen automatically, follow a newly
      // arrived spot quote. Once the user chooses a strike, leave it alone.
      const shouldUseAtm = !current
        || !strikes.includes(Number(current))
        || current === autoSelectedStrikeRef.current;
      if (!shouldUseAtm) return current;
      const next = String(atmStrike);
      autoSelectedStrikeRef.current = next;
      return next;
    });
  }, [atmStrike, strikes]);

  const selectedInstruments = useMemo(
    () => expiryInstruments.filter((instrument) =>
      String(instrument.strike) === selectedStrike &&
      (optionSide === "BOTH" || instrument.option_type === optionSide)
    ),
    [expiryInstruments, optionSide, selectedStrike]
  );

  const handleStart = async () => {
    setError(null);
    if (isWeekend(sessionDate)) {
      setError("Selected date is a weekend — the market was closed. Pick a weekday.");
      return;
    }
    const fallbackVolatility = Number(fallbackIv) / 100;
    if (!Number.isFinite(fallbackVolatility) || fallbackVolatility <= 0 || fallbackVolatility > 3) {
      setError("Fallback IV must be greater than 0% and no more than 300%.");
      return;
    }
    setIsGenerating(true);
    setLoadingLabel("Loading Historical Data...");
    try {
      // 1. Refresh the instruments list and validate the explicitly selected
      // expiry, strike, and option side. The complete selected expiry is
      // replayed below so every downstream workspace sees the same ladder.
      const instrumentData = await getInstruments(targetSymbol);

      if (!instrumentData || instrumentData.instruments.length === 0) {
        setError("Failed to fetch instruments for symbol.");
        return;
      }

      const selectedContracts = instrumentData.instruments.filter((instrument) =>
        instrument.expiry === selectedExpiry &&
        String(instrument.strike) === selectedStrike &&
        (optionSide === "BOTH" || instrument.option_type === optionSide)
      );
      if (selectedContracts.length === 0) {
        setError("Select a valid expiry, strike, and option side before starting replay.");
        return;
      }
      // The selected strike remains the replay's focus/metadata, but feed the
      // complete selected-expiry ladder. Option Chain, Dealer Flow, Strategy,
      // and the Greek workspace can then all consume the same historical
      // session even when a user chooses another strike after playback starts.
      const replayInstruments = instrumentData.instruments.filter((instrument) => instrument.expiry === selectedExpiry);

      const candles = await getHistoricalCandles(targetSymbol, sessionDate, sessionDate, resolution);
      if (!candles || candles.length === 0) {
        setError("No historical data returned for this date (market may have been closed).");
        return;
      }

      // 2. Build the tick-by-tick session, modeling every option off the real
      // spot with Black-Scholes as a baseline.
      const { allTicks } = buildReplaySession(
        targetSymbol,
        candles,
        replayInstruments,
        fallbackVolatility,
        riskFreeRate,
      );

      // 3. Try to replace near-the-money contracts on the nearest expiry with
      // the broker's own real historical prices, where Fyers actually has
      // them. Anything it doesn't cover keeps its modeled price from step 2.
      setLoadingLabel("Fetching real option prices...");
      const coverage = await enrichReplaySessionWithRealPrices(
        targetSymbol,
        allTicks,
        replayInstruments,
        sessionDate,
        resolution
      );
      setPriceCoverage(coverage);

      // 4. Setup Store and Start
      setReplayInstruments(replayInstruments);
      setSymbol(targetSymbol);
      setStoreSessionDate(sessionDate);
      setStoreExpiry(selectedExpiry);
      setStoreStrike(Number(selectedStrike));
      setStoreOptionSide(optionSide);
      setSpeedMultiplier(replayPreferences.speedMultiplier);
      setIsActive(true);
      setIsPlaying(true);

      startPlayback(allTicks, () => {
        // Handle completion
        setIsActive(false);
        reset();
      });
    } catch (err) {
      console.error(err);
      setError(formatApiError(err) || "Error starting replay.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStop = () => {
    stopPlayback();
    reset();
  };

  return (
    <DashboardLayout>
      <PageContainer className="max-w-4xl">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-[var(--color-text-bright)]">
            <History className="h-6 w-6 text-[var(--color-accent-blue)]" /> Replay Mode
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Replay a real historical trading session to test your strategies and observe Dealer Flow shifting over time.
          </p>
        </div>

        {isActive ? (
          <Card className="flex flex-col items-center justify-center gap-4 border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5 p-12 text-center">
            <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-[var(--color-accent-blue)]/20">
              <PlayCircle className="h-8 w-8 text-[var(--color-accent-blue)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--color-text-bright)]">Replay Active</h2>
              <p className="mx-auto mt-2 max-w-md text-[var(--color-text-secondary)]">
                Real historical ticks for {sessionDate} are currently feeding all dashboards.
                Use the sidebar to navigate to the <b>Option Chain</b> or <b>Dealer Flow</b> to watch the market move.
              </p>
              {priceCoverage && priceCoverage.attempted > 0 && (
                <p className="mx-auto mt-2 max-w-md text-xs text-[var(--color-text-muted)]">
                  {priceCoverage.matched} of {priceCoverage.attempted} near-ATM expiry contracts are using{" "}
                  <b className="text-[var(--color-text-secondary)]">real broker prices</b>; the rest (and everything
                  further from the money) are modeled with Black-Scholes.
                </p>
              )}
            </div>
            <Button variant="outline" onClick={handleStop} className="mt-4 hover:text-[var(--color-loss)]">
              Stop Replay
            </Button>
          </Card>
        ) : (
          <Card className="flex flex-col gap-6">
            <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] pb-4 text-sm font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">
              <Settings2 className="h-4 w-4" /> Configuration
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Underlying Asset</label>
                <Select value={targetSymbol} onChange={e => setTargetSymbol(e.target.value)}>
                  <option value="NIFTY">NIFTY 50</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                  <option value="FINNIFTY">FINNIFTY</option>
                  <option value="MIDCPNIFTY">MIDCPNIFTY</option>
                  <option value="SENSEX">S&amp;P BSE SENSEX</option>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Session Date</label>
                <Input
                  type="date"
                  value={sessionDate}
                  max={yesterday()}
                  onChange={e => setSessionDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Option Expiry</label>
                <Select
                  value={selectedExpiry}
                  onChange={(event) => {
                    setSelectedExpiry(event.target.value);
                    setSelectedStrike("");
                    autoSelectedStrikeRef.current = "";
                  }}
                  disabled={isLoadingInstruments || expiries.length === 0}
                >
                  {expiries.length === 0 ? (
                    <option value="">{isLoadingInstruments ? "Loading expiries…" : "No expiry available"}</option>
                  ) : expiries.map((expiry) => (
                    <option key={expiry} value={expiry}>{expiry}</option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Option Strike</label>
                <Select
                  value={selectedStrike}
                  onChange={(event) => {
                    setSelectedStrike(event.target.value);
                    // A manual choice should not be replaced by the next
                    // quote tick, even when the selected strike is ATM.
                    autoSelectedStrikeRef.current = "__manual__";
                  }}
                  disabled={isLoadingInstruments || strikes.length === 0}
                >
                  {strikes.length === 0 ? (
                    <option value="">{isLoadingInstruments ? "Loading strikes…" : "No strike available"}</option>
                  ) : strikes.map((strike) => (
                    <option key={strike} value={strike} aria-label={strike.toLocaleString("en-IN")}>
                      {formatStrikeWithPosition(strike, strikes, strikeSpot, optionSide)}
                    </option>
                  ))}
                </Select>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  ATM: {atmStrike === null ? "—" : atmStrike.toLocaleString("en-IN")} · spot {strikeSpot.toLocaleString("en-IN")}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {selectedInstruments.length} focused contract{selectedInstruments.length === 1 ? "" : "s"}; the full {expiryInstruments.length}-contract expiry ladder feeds every workspace.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Option Side</label>
                <Select value={optionSide} onChange={(event) => setOptionSide(event.target.value as "BOTH" | "CE" | "PE")}>
                  <option value="BOTH">Call + Put</option>
                  <option value="CE">Call (CE)</option>
                  <option value="PE">Put (PE)</option>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Candle Resolution</label>
                <Select value={resolution} onChange={e => setResolution(e.target.value as typeof resolution)}>
                  <option value="1">1 Minute</option>
                  <option value="5">5 Minute</option>
                  <option value="15">15 Minute</option>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Fallback IV for Modeled Contracts (%)</label>
                <Input
                  type="number"
                  min="0.01"
                  max="300"
                  step="0.1"
                  value={fallbackIv}
                  onChange={e => setFallbackIv(e.target.value)}
                />
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Defaults by underlying; used only when historical option prices are unavailable.
                </span>
              </div>
            </div>

            {instrumentError && <p className="text-sm text-[var(--color-loss)]">{instrumentError}</p>}

            <div className="flex gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] p-4 text-sm text-[var(--color-text-secondary)]">
              <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-status-warning)]" />
              <p>
                This mode will disconnect your live broker WebSocket feed and instead replay real historical candles
                for the chosen date. The underlying price path is always real broker data. For near-the-money
                contracts, option prices are also fetched as real historical data from the broker where available;
                contracts the broker has no history for fall back to a Black-Scholes model off the real spot, at the
                fallback IV above.
                <br /><br />
                <b>All dashboards will render this replayed session until stopped.</b>
              </p>
            </div>

            {error && (
              <p className="text-sm text-[var(--color-loss)]">{error}</p>
            )}

            <Button onClick={handleStart} disabled={isGenerating} size="md" className="mt-2 h-12 w-full">
              <PlayCircle className="h-5 w-5" />
              {isGenerating ? loadingLabel : "Start Replay"}
            </Button>
          </Card>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
