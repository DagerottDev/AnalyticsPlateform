"use client";

import { useReplayStore } from "@/stores/replayStore";
import { stopPlayback } from "@/lib/replayEngine";
import { Play, Pause, Square, FastForward } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

export function ReplayController() {
  const {
    isActive,
    isPlaying,
    setIsPlaying,
    speedMultiplier,
    setSpeedMultiplier,
    progressPercentage,
    symbol,
    sessionDate,
    expiry,
    strike,
    optionSide,
    priceCoverage,
    reset
  } = useReplayStore();

  const pathname = usePathname();
  const router = useRouter();

  // If not active, only show if we are on the replay page itself
  if (!isActive) {
    if (pathname !== "/replay") return null;
    return null; // The page itself will handle setup
  }

  const handleStop = () => {
    stopPlayback();
    reset();
    if (pathname !== "/replay") {
      router.push("/replay");
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]/95 backdrop-blur-md p-4 shadow-2xl shadow-black/50 min-w-[300px]">
      <div className="flex items-center justify-between text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">
        <span>
          {symbol || "Replay"}
          {sessionDate && <span className="ml-1.5 font-normal normal-case text-[var(--color-text-muted)]">{sessionDate}</span>}
        </span>
        <span className="text-[var(--color-accent-blue)]">{speedMultiplier}x Speed</span>
      </div>

      {(expiry || strike !== null) && (
        <div className="text-center text-[10px] font-normal normal-case text-[var(--color-text-muted)]">
          {expiry || "Any expiry"} · {strike !== null ? strike.toLocaleString("en-IN") : "Any strike"} · {optionSide === "BOTH" ? "CE + PE" : optionSide}
        </div>
      )}

      {priceCoverage && priceCoverage.attempted > 0 && (
        <div
          className="text-center text-[10px] font-normal normal-case text-[var(--color-text-muted)]"
          title="Near-ATM contracts priced from real broker history; contracts without history are modeled with Black-Scholes."
        >
          {priceCoverage.matched}/{priceCoverage.attempted} near-ATM contracts using real broker prices
        </div>
      )}

      <div className="w-full h-2 bg-[var(--color-bg-hover)] rounded-full overflow-hidden mt-1">
        <div
          className="h-full bg-[var(--color-accent-blue)] transition-all duration-300 ease-linear"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      <div className="flex items-center justify-center gap-4 mt-2">
        <button 
          onClick={handleStop}
          className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-accent-red)] transition-colors"
          title="Stop Replay"
        >
          <Square className="w-5 h-5 fill-current" />
        </button>

        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-3 bg-[var(--color-accent-blue)] text-white rounded-full hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
             <Pause className="w-6 h-6 fill-current" />
          ) : (
             <Play className="w-6 h-6 fill-current" />
          )}
        </button>

        <button 
          onClick={() => {
            if (speedMultiplier === 1) setSpeedMultiplier(5);
            else if (speedMultiplier === 5) setSpeedMultiplier(10);
            else if (speedMultiplier === 10) setSpeedMultiplier(100);
            else setSpeedMultiplier(1);
          }}
          className="p-2 text-[var(--color-text-muted)] hover:text-white transition-colors"
          title="Change Speed"
        >
          <FastForward className="w-5 h-5 fill-current" />
        </button>
      </div>
    </div>
  );
}
