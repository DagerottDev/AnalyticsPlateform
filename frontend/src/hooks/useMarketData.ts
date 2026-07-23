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
  const symbolsKey = symbols.join(",");

  useEffect(() => {
    // If Replay Mode is active, we disconnect/ignore live websocket
    if (replayIsActive) return;

    if (!user?.client_id) return;

    const ws = getWebSocket();

    // Always (re)subscribe the full current symbol list on the shared
    // websocket client — it already refcounts symbol->handler membership
    // internally, so resubscribing a symbol that's already registered is a
    // harmless no-op (no duplicate wire message). Gating this call behind
    // an "is this symbol new" check computed from a ref, as a previous
    // version did, broke under React 18 StrictMode's dev-mode double-invoke
    // (mount -> cleanup -> mount): the cleanup unsubscribed the handler, but
    // the ref already reflected the post-subscribe state, so the second
    // mount's diff saw "nothing added" and never re-registered the handler —
    // ticks then silently stopped reaching this hook for the rest of the
    // component's lifetime (a one-time REST seed fetch would still show a
    // value, making it look like a stale/frozen price rather than a dead
    // subscription).
    ws.subscribeMany(symbols, handleTick);

    // Seed ticks immediately via REST quote snapshot, but only for symbols
    // we haven't already seeded — a pure optimization (avoids re-fetching
    // quotes for a symbol set that hasn't changed), not load-bearing for
    // correctness like the subscribe call above is.
    const addedSymbols = symbols.filter(s => !prevSymbols.current.includes(s));
    if (addedSymbols.length > 0) {
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
      ws.unsubscribeMany(symbols, handleTick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- symbolsKey is the intentional stable proxy for `symbols`
  }, [symbolsKey, user, replayIsActive, handleTick]);

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
