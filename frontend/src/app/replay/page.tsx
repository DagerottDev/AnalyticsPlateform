"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useReplayStore } from "@/stores/replayStore";
import { buildReplaySession, startPlayback, stopPlayback } from "@/lib/replayEngine";
import { getInstruments, getHistoricalCandles } from "@/lib/market";
import { formatApiError } from "@/lib/apiError";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { History, PlayCircle, Settings2, AlertTriangle } from "lucide-react";

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

export default function ReplayPage() {
  const {
    isActive,
    setIsActive,
    setIsPlaying,
    setSymbol,
    setSessionDate: setStoreSessionDate,
    reset,
  } = useReplayStore();

  const [targetSymbol, setTargetSymbol] = useState("NIFTY");
  const [sessionDate, setSessionDate] = useState(yesterday());
  const [resolution, setResolution] = useState("1");
  const [volatility, setVolatility] = useState("15"); // used to price options off the real spot path
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);
    if (isWeekend(sessionDate)) {
      setError("Selected date is a weekend — the market was closed. Pick a weekday.");
      return;
    }
    setIsGenerating(true);
    try {
      // 1. Fetch the real instruments list so we have valid strikes to price
      const [instrumentData, candles] = await Promise.all([
        getInstruments(targetSymbol),
        getHistoricalCandles(targetSymbol, sessionDate, sessionDate, resolution),
      ]);

      if (!instrumentData || instrumentData.instruments.length === 0) {
        setError("Failed to fetch instruments for symbol.");
        return;
      }
      if (!candles || candles.length === 0) {
        setError("No historical data returned for this date (market may have been closed).");
        return;
      }

      // 2. Build the tick-by-tick session from real historical candles
      const { allTicks } = buildReplaySession(
        targetSymbol,
        candles,
        instrumentData.instruments,
        Number(volatility) / 100
      );

      // 3. Setup Store and Start
      setSymbol(targetSymbol);
      setStoreSessionDate(sessionDate);
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
                <label className="text-sm text-[var(--color-text-muted)]">Candle Resolution</label>
                <Select value={resolution} onChange={e => setResolution(e.target.value)}>
                  <option value="1">1 Minute</option>
                  <option value="5">5 Minute</option>
                  <option value="15">15 Minute</option>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Model Volatility (IV %)</label>
                <Input
                  type="number"
                  value={volatility}
                  onChange={e => setVolatility(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] p-4 text-sm text-[var(--color-text-secondary)]">
              <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-status-warning)]" />
              <p>
                This mode will disconnect your live broker WebSocket feed and instead replay real historical candles
                for the chosen date. The underlying price path is real broker data; option prices are derived from
                that real spot using Black-Scholes (the same pricing engine used elsewhere in this app) at the
                volatility above, since the broker does not expose historical tick data per option contract.
                <br /><br />
                <b>All dashboards will render this replayed session until stopped.</b>
              </p>
            </div>

            {error && (
              <p className="text-sm text-[var(--color-loss)]">{error}</p>
            )}

            <Button onClick={handleStart} disabled={isGenerating} size="md" className="mt-2 h-12 w-full">
              <PlayCircle className="h-5 w-5" />
              {isGenerating ? "Loading Historical Data..." : "Start Replay"}
            </Button>
          </Card>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
