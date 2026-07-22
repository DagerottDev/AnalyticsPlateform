import { MarketTick } from "@/types/market";
import { useApiErrorLogStore } from "@/stores/apiErrorLogStore";

type TickHandler = (tick: MarketTick) => void;

const WS_CLOSE_REASONS: Record<number, string> = {
  4401: "Authentication failed (invalid or expired session token).",
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
}

/**
 * Maps either backend tick shape onto the app's MarketTick shape. Fyers'
 * live "scrips" (option/equity) tick payload never includes open interest
 * — the upstream SDK strips it before it reaches us — so OI is always 0
 * for live-tick-shaped messages; the REST quote poller doesn't carry it
 * either (Fyers' quotes endpoint doesn't return OI), so it's 0 there too.
 */
function normalizeTick(raw: RawFyersTick): MarketTick | null {
  if (raw.trading_symbol && typeof raw.last_price === "number") {
    return {
      trading_symbol: raw.trading_symbol,
      last_price: raw.last_price,
      volume: raw.volume ?? 0,
      open_interest: raw.open_interest ?? 0,
      timestamp: raw.timestamp ? raw.timestamp * 1000 : Date.now(),
      change: raw.change ?? 0,
      change_percent: raw.change_percent ?? 0,
    };
  }
  if (!raw.symbol || typeof raw.ltp !== "number") return null;
  return {
    trading_symbol: raw.symbol,
    last_price: raw.ltp,
    volume: raw.vol_traded_today ?? 0,
    open_interest: 0,
    timestamp: Date.now(),
    change: raw.ch ?? 0,
    change_percent: raw.chp ?? 0,
  };
}

/**
 * Single shared connection to the backend's /market/ws proxy, which relays
 * live Fyers ticks for whatever symbols have at least one subscriber here.
 * Reconnects with backoff on drop, and re-subscribes to everything that
 * had listeners once the connection (re)opens.
 */
class MarketWebSocketClient {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<TickHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private noTokenLogged = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    const token = getAuthToken();
    if (!token) {
      if (!this.noTokenLogged) {
        this.noTokenLogged = true;
        logWsFailure("Market stream: no auth token found yet — will retry.", null);
      }
      this.scheduleReconnect();
      return;
    }
    this.noTokenLogged = false;

    const url = `${toWebSocketUrl(API_URL_WITH_VERSION)}/market/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
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
        this.subscribers.get(tick.trading_symbol)?.forEach((handler) => handler(tick));
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onclose = (event) => {
      this.ws = null;
      if (!this.destroyed && event.code !== 1000) {
        const reason = WS_CLOSE_REASONS[event.code] || event.reason || "Connection closed unexpectedly.";
        logWsFailure(`Market stream disconnected (code ${event.code}): ${reason}`, event.code);
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose always follows onerror for a failed connection and carries
      // a close code/reason, so the failure is logged there instead of here
      // to avoid double-logging the same event.
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
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
    if (newSymbols.length > 0) this.send({ action: "subscribe", symbols: newSymbols });
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

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.subscribers.clear();
  }
}

let instance: MarketWebSocketClient | null = null;

export function getWebSocket(): MarketWebSocketClient {
  if (!instance) {
    instance = new MarketWebSocketClient();
  }
  return instance;
}
