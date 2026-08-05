"use client";

import { useCallback, useEffect, useRef } from "react";
import { getWebSocket } from "@/lib/websocket";
import { useAuth } from "@/hooks/useAuth";
import { useTickerStore } from "@/stores/tickerStore";
import { useTickStore } from "@/stores/tickStore";
import { useReplayStore } from "@/stores/replayStore";
import { MarketTick } from "@/types/market";
import { useNseMarketSession } from "@/hooks/useNseMarketSession";
import { isFnoSymbol } from "@/lib/marketSession";

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
  const replayTicks = useReplayStore((state) => state.currentTicks);
  const fnoSession = useNseMarketSession("fno");
  const cashSession = useNseMarketSession("cash");
  const prevSymbols = useRef<string[]>([]);
  const wasReplaying = useRef(false);

  const handleTick = useCallback((tick: MarketTick) => {
    useTickStore.getState().setTick(tick);
  }, []);

  // The dashboard ticker and other long-lived consumers read the shared tick
  // store rather than calling useMarketData directly. Mirror every replay
  // step there as well, so replay is genuinely app-wide instead of limited to
  // pages that happen to subscribe to the interception hook.
  useEffect(() => {
    if (replayIsActive) {
      wasReplaying.current = true;
      useTickStore.getState().setTicks(Object.values(replayTicks));
      return;
    }
    if (wasReplaying.current) {
      wasReplaying.current = false;
      useTickStore.getState().clear();
    }
  }, [replayIsActive, replayTicks]);

  useEffect(() => {
    const ws = getWebSocket();
    const requestedSymbols = user?.client_id && !replayIsActive
      ? tickers.filter((symbol) => isFnoSymbol(symbol) ? fnoSession.state === "open" : cashSession.state === "open")
      : [];

    const removedSymbols = prevSymbols.current.filter((s) => !requestedSymbols.includes(s));
    if (removedSymbols.length > 0) ws.unsubscribeMany(removedSymbols, handleTick);

    const addedSymbols = requestedSymbols.filter((s) => !prevSymbols.current.includes(s));
    if (addedSymbols.length > 0) {
      ws.subscribeMany(addedSymbols, handleTick);
      // The shared websocket sends an immediate broker snapshot and keeps a
      // per-session fallback poll running. Do not duplicate it with a REST
      // request for every mount/navigation.
    }

    prevSymbols.current = requestedSymbols;
  }, [tickers, user?.client_id, replayIsActive, fnoSession.state, cashSession.state, handleTick]);

  return null;
}
