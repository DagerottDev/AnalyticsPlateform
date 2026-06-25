import { useEffect, useState, useCallback, useRef } from "react";
import { getWebSocket } from "@/lib/websocket";
import { MarketTick, TickData } from "@/types/market";
import { useAuth } from "@/hooks/useAuth";
import { useReplayStore } from "@/stores/replayStore";

export function useMarketData(symbols: string[]) {
  const { user } = useAuth();
  const [ticks, setTicks] = useState<Record<string, MarketTick>>({});
  
  // Replay Interception
  const replayIsActive = useReplayStore(state => state.isActive);
  const replayTicks = useReplayStore(state => state.currentTicks);
  
  // Use ref to avoid re-running effects on symbols change if not necessary,
  // but we do want to resubscribe when symbols change.
  const prevSymbols = useRef<string[]>([]);

  useEffect(() => {
    // If Replay Mode is active, we disconnect/ignore live websocket
    if (replayIsActive) return;

    if (!user?.openalgo_host || !user?.client_id) return;
    
    const ws = getWebSocket(user.openalgo_host, "internal_dev_key");
    
    const handleTick = (tick: MarketTick) => {
      setTicks((prev) => ({
        ...prev,
        [tick.trading_symbol]: tick,
      }));
    };

    // Unsubscribe from old symbols not in the new list
    const removedSymbols = prevSymbols.current.filter(s => !symbols.includes(s));
    removedSymbols.forEach(s => ws.unsubscribe(s, handleTick));

    // Subscribe to new symbols
    const addedSymbols = symbols.filter(s => !prevSymbols.current.includes(s));
    addedSymbols.forEach(s => ws.subscribe(s, handleTick));

    // Initial subscription if it's the first render
    if (prevSymbols.current.length === 0) {
      symbols.forEach(s => ws.subscribe(s, handleTick));
    }

    prevSymbols.current = symbols;

    return () => {
      // Cleanup: unsubscribe from all when component unmounts
      symbols.forEach(s => ws.unsubscribe(s, handleTick));
    };
  }, [symbols, user, replayIsActive]);

  const getTick = useCallback((symbol: string): MarketTick | null => {
    if (replayIsActive) {
      // We cast TickData back to MarketTick (they are practically identical in our mock context)
      return (replayTicks[symbol] as MarketTick) || null;
    }
    return ticks[symbol] || null;
  }, [ticks, replayTicks, replayIsActive]);

  return {
    ticks: replayIsActive ? replayTicks : ticks,
    getTick
  };
}
