"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useReplayStore } from "@/stores/replayStore";
import { generateSessionTicks, startPlayback, stopPlayback } from "@/lib/replayEngine";
import { getInstruments } from "@/lib/market";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { PageContainer } from "@/components/ui/PageContainer";
import { History, PlayCircle, Settings2, AlertTriangle } from "lucide-react";

export default function ReplayPage() {
  const { isActive, setIsActive, setIsPlaying, setSymbol, reset } = useReplayStore();

  const [targetSymbol, setTargetSymbol] = useState("NIFTY");
  const [startPrice, setStartPrice] = useState("22000");
  const [volatility, setVolatility] = useState("15"); // 15% IV
  const [isGenerating, setIsGenerating] = useState(false);

  const handleStart = async () => {
    setIsGenerating(true);
    try {
      // 1. Fetch the real instruments list so we have valid strikes to simulate
      const data = await getInstruments(targetSymbol);
      if (!data || data.instruments.length === 0) {
        alert("Failed to fetch instruments for symbol.");
        return;
      }

      // 2. Generate the entire day's simulation mathematically
      const { allTicks } = generateSessionTicks(
        targetSymbol,
        Number(startPrice),
        Number(volatility) / 100, // convert to decimal
        data.instruments
      );

      // 3. Setup Store and Start
      setSymbol(targetSymbol);
      setIsActive(true);
      setIsPlaying(true);

      startPlayback(allTicks, () => {
        // Handle completion
        setIsActive(false);
        reset();
      });

    } catch (err) {
      console.error(err);
      alert("Error starting replay.");
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
            Simulate a trading session to test your strategies and observe Dealer Flow shifting in real-time.
          </p>
        </div>

        {isActive ? (
          <Card className="flex flex-col items-center justify-center gap-4 border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5 p-12 text-center">
            <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-[var(--color-accent-blue)]/20">
              <PlayCircle className="h-8 w-8 text-[var(--color-accent-blue)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--color-text-bright)]">Simulation Active</h2>
              <p className="mx-auto mt-2 max-w-md text-[var(--color-text-secondary)]">
                A mathematical simulation is currently feeding live ticks to all dashboards.
                Use the sidebar to navigate to the <b>Option Chain</b> or <b>Dealer Flow</b> to watch the market move.
              </p>
            </div>
            <Button variant="outline" onClick={handleStop} className="mt-4 hover:text-[var(--color-loss)]">
              Stop Simulation
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
                <label className="text-sm text-[var(--color-text-muted)]">Starting Price</label>
                <Input
                  type="number"
                  value={startPrice}
                  onChange={e => setStartPrice(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Base Volatility (IV %)</label>
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
                This mode will disconnect your live broker WebSocket feed and inject thousands of mathematically simulated
                ticks (using Geometric Brownian Motion) to test platform stability and analytic responsiveness.
                <br /><br />
                <b>All dashboards will render this simulated data until stopped.</b>
              </p>
            </div>

            <Button onClick={handleStart} disabled={isGenerating} size="md" className="mt-2 h-12 w-full">
              <PlayCircle className="h-5 w-5" />
              {isGenerating ? "Generating Simulation..." : "Start Simulation"}
            </Button>
          </Card>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
