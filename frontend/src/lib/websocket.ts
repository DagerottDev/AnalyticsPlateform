import { MarketTick } from "@/types/market";
import { useApiErrorLogStore } from "@/stores/apiErrorLogStore";

type TickHandler = (tick: MarketTick) => void;

const WS_CLOSE_REASONS: Record<number, string> = {
  4000: "No market data received within the liveness window.",
  4401: "Authentication failed (invalid or expired session token).",
  4410: "The broker session changed; reconnecting to the current stream.",
};

function logWsFailure(message: string, status: number | null, detail?: string): void {
  useApiErrorLogStore.getState().logError({
    method: "WS",
    url: "/market/ws",
    status,
    message,
    detail: detail ?? message,
  });
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_URL_WITH_VERSION = API_BASE_URL.endsWith("/api/v1")
  ? API_BASE_URL
  : `${API_BASE_URL.replace(/\/api$/, "")}/api/v1`;

const MAX_RECONNECT_DELAY_MS = 15000;
const MAX_TICK_SILENCE_MS = 60_000;

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("auth-storage");
  if (!raw) return null;
  try {
    const { state } = JSON.parse(raw);
    return (state?.token as string | undefined) || null;
  } catch {
    return null;
  }
}

function toWebSocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

interface RawFyersTick {
  // Raw live-tick shape, straight from the Fyers websocket.
  symbol?: string;
  ltp?: number;
  vol_traded_today?: number;
  ch?: number;
  chp?: number;
  // Already-normalized quote shape, from the backend's REST quotes poller
  // (a resilience fallback that keeps refreshing via REST regardless of
  // whether the live Fyers websocket tick stream is actually flowing).
  trading_symbol?: string;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  change?: number;
  change_percent?: number;
  timestamp?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  prev_close_price?: number;
  ask?: number;
  bid?: number;
  atp?: number;
}

/**
 * Maps either backend tick shape onto the app's MarketTick shape. Fyers'
 * live "scrips" (option/equity) tick payload never includes open interest
 * — the upstream SDK strips it before it reaches us — so OI is always 0
 * for live-tick-shaped messages; the REST quote poller doesn't carry it
 * either (Fyers' quotes endpoint doesn't return OI), so it's 0 there too.
 */
export function normalizeTick(raw: RawFyersTick): MarketTick | null {
  if (raw.trading_symbol && typeof raw.last_price === "number") {
    return {
      trading_symbol: raw.trading_symbol,
      last_price: raw.last_price,
      volume: raw.volume ?? 0,
      open_interest: raw.open_interest ?? 0,
      timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now(),
      change: raw.change ?? 0,
      change_percent: raw.change_percent ?? 0,
      open_price: raw.open_price,
      high_price: raw.high_price,
      low_price: raw.low_price,
      prev_close_price: raw.prev_close_price,
      ask: raw.ask,
      bid: raw.bid,
      atp: raw.atp,
      // Quote-shaped frames are the REST seed/fallback that the backend
      // multiplexes onto this socket. They should not override a genuinely
      // active broker stream when the local exchange schedule is closed.
      feed: "snapshot",
    };
  }
  if (!raw.symbol || typeof raw.ltp !== "number") return null;
  const streamTimestamp = Date.now();
  return {
    trading_symbol: raw.symbol,
    last_price: raw.ltp,
    volume: raw.vol_traded_today ?? 0,
    open_interest: 0,
    timestamp: streamTimestamp,
    change: raw.ch ?? 0,
    change_percent: raw.chp ?? 0,
    feed: "stream",
    last_stream_timestamp: streamTimestamp,
  };
}

/**
 * Single shared connection to the backend's /market/ws proxy, which relays
 * live Fyers ticks for whatever symbols have at least one subscriber here.
 * Reconnects with backoff on drop, and re-subscribes to everything that
 * had listeners once the connection (re)opens.
 */
export class MarketWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<TickHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private preferredToken: string | null | undefined;
  private activeToken: string | null = null;
  private lastTickAt: number | null = null;
  private destroyed = false;
  private suspended = false;
  private readonly handlePageHide = () => {
    // Do not permanently destroy the singleton on pagehide.  Mobile browsers
    // and bfcache transitions can emit pagehide while the React tree remains
    // mounted; destroying here used to leave the shared client in a terminal
    // state with no way for TickerFeedMount to recreate it.  Suspend the
    // transport, retain subscriptions, and resume it from pageshow instead.
    this.suspended = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, "Page hidden");
    }
  };
  private readonly handlePageShow = () => {
    this.suspended = false;
    if (!this.destroyed && this.subscribers.size > 0 && !this.ws) {
      this.scheduleReconnect(0);
    }
  };
  private readonly handleVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.handlePageShow();
    }
  };

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handlePageHide);
      window.addEventListener("pageshow", this.handlePageShow);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.connect();
  }

  private connect(): void {
    if (this.destroyed || this.suspended) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.ws = null;
    const token = this.preferredToken === undefined ? getAuthToken() : this.preferredToken;
    if (!token) {
      // Authentication is a normal prerequisite, not a transport failure.
      // Hooks subscribe only after auth hydration/login, so waiting here must
      // not create a reconnect timer or pollute the API-failure log on every
      // unauthenticated page reload.
      return;
    }
    this.activeToken = token;

    const url = `${toWebSocketUrl(API_URL_WITH_VERSION)}/market/ws?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      // Some browsers throw synchronously for malformed URLs or a transport
      // that is unavailable.  Treat that exactly like an asynchronous close
      // so a transient failure cannot permanently stop the stream.
      logWsFailure(
        "Market stream could not be opened; retrying.",
        null,
        error instanceof Error ? error.message : String(error),
      );
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastTickAt = Date.now();
      this.startHeartbeat();
      const symbols = Array.from(this.subscribers.keys());
      if (symbols.length > 0) {
        this.send({ action: "subscribe", symbols });
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "info" || msg.type === "error" || msg.s === "error") {
          const messageStr = String(msg.message ?? msg.detail ?? "Market stream error");
          logWsFailure(messageStr, null, JSON.stringify(msg));
          if (msg.type !== "tick") return;
        }
        if (msg.type !== "tick") return;
        const tick = normalizeTick(msg.data as RawFyersTick);
        if (!tick) return;
        this.lastTickAt = Date.now();
        this.subscribers.get(tick.trading_symbol)?.forEach((handler) => handler(tick));
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onclose = (event) => {
      // A late close event from an older socket must not clear a newer one.
      const isCurrentSocket = this.ws === ws;
      if (isCurrentSocket) {
        this.ws = null;
        this.activeToken = null;
        this.stopHeartbeat();
      }
      if (!this.destroyed && event.code !== 1000 && event.code !== 4410) {
        const reason = WS_CLOSE_REASONS[event.code] || event.reason || "Connection closed unexpectedly.";
        logWsFailure(`Market stream disconnected (code ${event.code}): ${reason}`, event.code);
      }
      if (isCurrentSocket && !this.suspended && this.subscribers.size > 0) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose always follows onerror for a failed connection and carries
      // a close code/reason, so the failure is logged there instead of here
      // to avoid double-logging the same event.
      ws.close();
    };
  }

  private scheduleReconnect(delayOverrideMs?: number): void {
    if (this.destroyed || this.suspended || this.reconnectTimer) return;
    const delay =
      delayOverrideMs ?? Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // A small application-level heartbeat prevents an idle intermediary from
    // silently dropping the browser socket.  The backend answers with pong;
    // pong alone is not enough: the backend proxy can stay reachable while
    // its captured broker stream has gone silent. Reconnect after a full
    // minute without either a stream tick or REST fallback quote.
    this.heartbeatTimer = setInterval(() => {
      if (
        this.ws?.readyState === WebSocket.OPEN &&
        this.subscribers.size > 0 &&
        this.lastTickAt != null &&
        Date.now() - this.lastTickAt >= MAX_TICK_SILENCE_MS
      ) {
        this.ws.close(4000, "Market data stalled");
        return;
      }
      this.send({ action: "ping" });
    }, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Subscribes to many symbols in one websocket message. Each individual
   * subscribe on the backend triggers a real REST call to Fyers to resolve
   * symbol tokens plus a hardcoded delay, so a page like Option Chain
   * (40+ strikes) subscribing one-by-one can take tens of seconds and risk
   * tripping the connection's keepalive-ping timeout — batching keeps it
   * to one round trip.
   */
  subscribeMany(symbols: string[], handler: TickHandler): void {
    const newSymbols: string[] = [];
    for (const symbol of symbols) {
      const isNewSymbol = !this.subscribers.has(symbol);
      if (isNewSymbol) this.subscribers.set(symbol, new Set());
      this.subscribers.get(symbol)!.add(handler);
      if (isNewSymbol) newSymbols.push(symbol);
    }
    if (newSymbols.length > 0) {
      // TickerFeedMount can subscribe while the previous socket is still
      // connecting, or after a close event cleared it.  Ensure a transport is
      // scheduled before sending; onopen will replay the complete set too.
      if (!this.ws && !this.reconnectTimer) this.connect();
      this.send({ action: "subscribe", symbols: newSymbols });
    }
  }

  unsubscribeMany(symbols: string[], handler: TickHandler): void {
    const dropSymbols: string[] = [];
    for (const symbol of symbols) {
      const handlers = this.subscribers.get(symbol);
      if (!handlers) continue;
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(symbol);
        dropSymbols.push(symbol);
      }
    }
    if (dropSymbols.length > 0) this.send({ action: "unsubscribe", symbols: dropSymbols });
  }

  /** Recreate the transport when auth rotates, even if symbols are unchanged. */
  updateAuthToken(token: string | null): void {
    if (this.preferredToken === token) return;
    this.preferredToken = token;

    const ws = this.ws;
    if (
      this.activeToken === token &&
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, "Authentication changed");
      return;
    }
    this.ws = null;
    this.activeToken = null;
    if (token && this.subscribers.size > 0) this.scheduleReconnect(0);
  }

  destroy(): void {
    this.destroyed = true;
    this.suspended = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.activeToken = null;
    this.lastTickAt = null;
    this.subscribers.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handlePageHide);
      window.removeEventListener("pageshow", this.handlePageShow);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

let instance: MarketWebSocketClient | null = null;

export function getWebSocket(): MarketWebSocketClient {
  if (!instance || instance.isDestroyed()) {
    instance = new MarketWebSocketClient();
  }
  return instance;
}
