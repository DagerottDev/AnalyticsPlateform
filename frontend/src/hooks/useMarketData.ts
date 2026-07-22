import { useEffect, useState, useCallback, useRef } from "react";
import { getWebSocket } from "@/lib/websocket";
import { getMarketQuotes } from "@/lib/market";
import { MarketTick } from "@/types/market";
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

    if (!user?.client_id) return;

    const ws = getWebSocket();
    
    const handleTick = (tick: MarketTick) => {
      setTicks((prev) => ({
        ...prev,
        [tick.trading_symbol]: tick,
      }));
    };

    // Unsubscribe from old symbols not in the new list
    const removedSymbols = prevSymbols.current.filter(s => !symbols.includes(s));
    if (removedSymbols.length > 0) ws.unsubscribeMany(removedSymbols, handleTick);

    // Subscribe to new symbols (everything, on the first render)
    const addedSymbols = symbols.filter(s => !prevSymbols.current.includes(s));
    if (addedSymbols.length > 0) {
      ws.subscribeMany(addedSymbols, handleTick);

      // Seed ticks immediately via REST quote snapshot
      getMarketQuotes(addedSymbols)
        .then((res) => {
          if (Array.isArray(res.quotes)) {
            setTicks((prev) => {
              const updated = { ...prev };
              res.quotes.forEach((q: MarketTick) => {
                if (q.trading_symbol) {
                  updated[q.trading_symbol] = q;
                }
              });
              return updated;
            });
          }
        })
        .catch(() => {});
    }

    prevSymbols.current = symbols;

    return () => {
      // Cleanup: unsubscribe from all when component unmounts
      ws.unsubscribeMany(symbols, handleTick);
    };
  }, [symbols, user, replayIsActive]);

  const getTick = useCallback((symbol: string): MarketTick | null => {
    if (replayIsActive) {
      // We cast TickData back to MarketTick (they are practically identical in the replay context)
      return (replayTicks[symbol] as MarketTick) || null;
    }
    return ticks[symbol] || null;
  }, [ticks, replayTicks, replayIsActive]);

  return {
    ticks: replayIsActive ? replayTicks : ticks,
    getTick
  };
}
