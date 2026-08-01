import { useEffect, useState, useCallback, useRef } from "react";
import { getWebSocket } from "@/lib/websocket";
import { MarketTick } from "@/types/market";
import { useAuth } from "@/hooks/useAuth";
import { useReplayStore } from "@/stores/replayStore";
import { useNseMarketSession } from "@/hooks/useNseMarketSession";

export function useMarketData(symbols: string[]) {
  const { user } = useAuth();
  const [ticks, setTicks] = useState<Record<string, MarketTick>>({});

  // Replay Interception
  const replayIsActive = useReplayStore(state => state.isActive);
  const replayTicks = useReplayStore(state => state.currentTicks);
  const marketSession = useNseMarketSession();

  // Tracks the symbols currently registered with the shared websocket. Keeping
  // this separate from the render input lets us update subscriptions by diff
  // instead of tearing down every live symbol whenever one is added or removed.
  const subscribedSymbols = useRef<string[]>([]);

  // Stable across effect re-runs (only closes over setTicks, itself stable
  // from useState) so subscribe/unsubscribe always operate on the same
  // handler reference — required for the Set<TickHandler>-based bookkeeping
  // in MarketWebSocketClient to correctly remove a handler on cleanup.
  const handleTick = useCallback((tick: MarketTick) => {
    setTicks((prev) => ({
      ...prev,
      [tick.trading_symbol]: tick,
    }));
  }, []);

  // Callers often pass a freshly-constructed array (e.g. `[...syms, symbol]`)
  // on every render. Keying the effect off the array's *content* instead of
  // its reference means the effect only actually re-runs when the symbol set
  // changes, not on every parent re-render.
  const symbolsKey = Array.from(new Set(symbols)).join(",");

  useEffect(() => {
    const ws = getWebSocket();
    const requestedSymbols = user?.client_id && !replayIsActive && marketSession.state === "open"
      ? (symbolsKey ? symbolsKey.split(",") : [])
      : [];
    const previousSymbols = subscribedSymbols.current;
    const addedSymbols = requestedSymbols.filter((symbol) => !previousSymbols.includes(symbol));
    const removedSymbols = previousSymbols.filter((symbol) => !requestedSymbols.includes(symbol));

    if (removedSymbols.length > 0) ws.unsubscribeMany(removedSymbols, handleTick);
    if (addedSymbols.length > 0) ws.subscribeMany(addedSymbols, handleTick);
    subscribedSymbols.current = requestedSymbols;

    // The backend websocket seeds newly-subscribed symbols with quotes and
    // maintains one shared REST polling fallback per broker session. A
    // separate HTTP snapshot per mounted consumer duplicates that broker
    // traffic and can exhaust the API/broker rate limit during navigation.
  }, [symbolsKey, user?.client_id, replayIsActive, marketSession.state, handleTick]);

  useEffect(() => {
    return () => {
      const activeSymbols = subscribedSymbols.current;
      if (activeSymbols.length > 0) {
        getWebSocket().unsubscribeMany(activeSymbols, handleTick);
        subscribedSymbols.current = [];
      }
    };
  }, [handleTick]);

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
