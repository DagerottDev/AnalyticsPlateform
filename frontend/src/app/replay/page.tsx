"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useReplayStore } from "@/stores/replayStore";
import { generateSessionTicks, startPlayback, stopPlayback } from "@/lib/replayEngine";
import { getInstruments } from "@/lib/market";
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
      <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-bright)] flex items-center gap-2">
            <History className="w-6 h-6 text-[var(--color-accent-blue)]" /> Replay Mode
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Simulate a trading session to test your strategies and observe Dealer Flow shifting in real-time.
          </p>
        </div>

        {isActive ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5 p-12 text-center shadow-lg shadow-blue-500/10">
            <div className="w-16 h-16 rounded-full bg-[var(--color-accent-blue)]/20 flex items-center justify-center animate-pulse">
              <PlayCircle className="w-8 h-8 text-[var(--color-accent-blue)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--color-text-bright)]">Simulation Active</h2>
              <p className="text-[var(--color-text-muted)] max-w-md mx-auto mt-2">
                A mathematical simulation is currently feeding live ticks to all dashboards. 
                Use the sidebar to navigate to the <b>Option Chain</b> or <b>Dealer Flow</b> to watch the market move.
              </p>
            </div>
            <button 
              onClick={handleStop}
              className="mt-4 px-6 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[var(--color-text-secondary)] rounded-lg hover:text-[var(--color-accent-red)] transition-colors"
            >
              Stop Simulation
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-secondary)] uppercase tracking-widest border-b border-[var(--color-border-subtle)] pb-4">
              <Settings2 className="w-4 h-4" /> Configuration
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Underlying Asset</label>
                <select 
                  className="h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                  value={targetSymbol}
                  onChange={e => setTargetSymbol(e.target.value)}
                >
                  <option value="NIFTY">NIFTY 50</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                  <option value="FINNIFTY">FINNIFTY</option>
                  <option value="MIDCPNIFTY">MIDCPNIFTY</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Starting Price</label>
                <input 
                  type="number"
                  className="h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                  value={startPrice}
                  onChange={e => setStartPrice(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-[var(--color-text-muted)]">Base Volatility (IV %)</label>
                <input 
                  type="number"
                  className="h-10 bg-[#18181b] text-sm text-[var(--color-text-primary)] rounded-md px-3 outline-none border border-[var(--color-border-subtle)]"
                  value={volatility}
                  onChange={e => setVolatility(e.target.value)}
                />
              </div>
            </div>

            <div className="bg-[#18181b] p-4 rounded-lg flex gap-3 text-sm text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
              <p>
                This mode will disconnect your live broker WebSocket feed and inject thousands of mathematically simulated
                ticks (using Geometric Brownian Motion) to test platform stability and analytic responsiveness. 
                <br/><br/>
                <b>All dashboards will render this simulated data until stopped.</b>
              </p>
            </div>

            <button 
              onClick={handleStart}
              disabled={isGenerating}
              className="mt-2 w-full h-12 flex items-center justify-center gap-2 bg-[var(--color-accent-blue)] text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              <PlayCircle className="w-5 h-5" /> 
              {isGenerating ? "Generating Simulation..." : "Start Simulation"}
            </button>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
