"use client";

import { useCallback, useEffect, useRef } from "react";
import { getWebSocket } from "@/lib/websocket";
import { getMarketQuotes } from "@/lib/market";
import { useAuth } from "@/hooks/useAuth";
import { useTickerStore } from "@/stores/tickerStore";
import { useTickStore } from "@/stores/tickStore";
import { useReplayStore } from "@/stores/replayStore";
import { MarketTick } from "@/types/market";

/**
 * Dummy component (mounted once in the root layout, like AlertEngineMount)
 * that keeps the pinned dashboard ticker symbols subscribed to the live
 * market-data websocket for the whole page load, not just while the
 * Dashboard page happens to be mounted.
 *
 * DashboardLayout is rendered per-page rather than in a shared Next.js
 * layout, so it fully unmounts/remounts on every client-side navigation.
 * When the ticker subscription lived inside useMarketData (called from
 * DashboardPage itself), that remount tore the subscription down on the way
 * out — triggering a real backend resubscribe (symbol-token resolution +
 * delay) on the way back in — and reset the tick cache to empty, flashing
 * the loading skeleton even for symbols that had already been streaming
 * live data seconds earlier. Owning the subscription here instead means
 * neither the subscription nor the last-known price ever goes away just
 * because the user looked at another page.
 */
export function TickerFeedMount() {
  const { user } = useAuth();
  const tickers = useTickerStore((state) => state.tickers);
  const replayIsActive = useReplayStore((state) => state.isActive);
  const prevSymbols = useRef<string[]>([]);

  const handleTick = useCallback((tick: MarketTick) => {
    useTickStore.getState().setTick(tick);
  }, []);

  useEffect(() => {
    if (replayIsActive) return;
    if (!user?.client_id) return;

    const ws = getWebSocket();

    const removedSymbols = prevSymbols.current.filter((s) => !tickers.includes(s));
    if (removedSymbols.length > 0) ws.unsubscribeMany(removedSymbols, handleTick);

    const addedSymbols = tickers.filter((s) => !prevSymbols.current.includes(s));
    if (addedSymbols.length > 0) {
      ws.subscribeMany(addedSymbols, handleTick);
      getMarketQuotes(addedSymbols)
        .then((res) => {
          if (Array.isArray(res.quotes)) {
            useTickStore.getState().setTicks(res.quotes);
          }
        })
        .catch(() => {});
    }

    prevSymbols.current = tickers;
  }, [tickers, user, replayIsActive, handleTick]);

  return null;
}
