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
  symbol?: string;
  ltp?: number;
  vol_traded_today?: number;
  ch?: number;
  chp?: number;
}

/**
 * Maps the backend's raw Fyers tick fields onto the app's MarketTick shape.
 * Fyers' live "scrips" (option/equity) tick payload never includes open
 * interest — the upstream SDK strips it before it reaches us — so OI here
 * is always 0. Real OI only comes from the periodic option-chain REST fetch.
 */
function normalizeTick(raw: RawFyersTick): MarketTick | null {
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
        if (msg.type === "info") {
          // e.g. "No live Fyers session — ticks unavailable." — not a
          // connection failure, but important to surface: it means the
          // backend has no active broker session for this user right now.
          logWsFailure(String(msg.message ?? "Market stream: no data available"), null);
          return;
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

  subscribe(symbol: string, handler: TickHandler): void {
    const isNewSymbol = !this.subscribers.has(symbol);
    if (isNewSymbol) this.subscribers.set(symbol, new Set());
    this.subscribers.get(symbol)!.add(handler);
    if (isNewSymbol) this.send({ action: "subscribe", symbols: [symbol] });
  }

  unsubscribe(symbol: string, handler: TickHandler): void {
    const handlers = this.subscribers.get(symbol);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.subscribers.delete(symbol);
      this.send({ action: "unsubscribe", symbols: [symbol] });
    }
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
