import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketWebSocketClient, normalizeTick } from "../lib/websocket";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(code: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  close(code = 1000, reason = ""): void {
    this.emitClose(code, reason);
  }
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal("localStorage", createMemoryStorage());
  localStorage.setItem(
    "auth-storage",
    JSON.stringify({ state: { token: "test-token" } }),
  );
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("normalizeTick", () => {
  it("normalizes an already-quote-shaped message (from the REST quotes poller)", () => {
    const tick = normalizeTick({
      trading_symbol: "NIFTY",
      last_price: 22050.5,
      volume: 1000,
      open_interest: 0,
      change: 12.3,
      change_percent: 0.06,
      timestamp: 1721800000,
    });

    expect(tick).toEqual({
      trading_symbol: "NIFTY",
      last_price: 22050.5,
      volume: 1000,
      open_interest: 0,
      timestamp: 1721800000000, // seconds -> ms
      change: 12.3,
      change_percent: 0.06,
      feed: "snapshot",
    });
  });

  it("normalizes a raw live Fyers websocket tick, defaulting missing fields", () => {
    const tick = normalizeTick({ symbol: "NSE:NIFTY50-INDEX", ltp: 22100 });

    expect(tick?.trading_symbol).toBe("NSE:NIFTY50-INDEX");
    expect(tick?.last_price).toBe(22100);
    expect(tick?.volume).toBe(0);
    expect(tick?.open_interest).toBe(0);
    expect(tick?.change).toBe(0);
    expect(tick?.change_percent).toBe(0);
    expect(tick?.feed).toBe("stream");
    expect(tick?.last_stream_timestamp).toBe(tick?.timestamp);
  });

  it("carries through volume/change fields on a raw live tick when present", () => {
    const tick = normalizeTick({
      symbol: "NSE:NIFTY50-INDEX",
      ltp: 22100,
      vol_traded_today: 5000,
      ch: 15.2,
      chp: 0.07,
    });

    expect(tick?.volume).toBe(5000);
    expect(tick?.change).toBe(15.2);
    expect(tick?.change_percent).toBe(0.07);
  });

  it("returns null for a message matching neither shape", () => {
    expect(normalizeTick({})).toBeNull();
    expect(normalizeTick({ symbol: "NIFTY" })).toBeNull(); // no ltp
    expect(normalizeTick({ ltp: 100 })).toBeNull(); // no symbol
  });
});

describe("MarketWebSocketClient lifecycle", () => {
  it("stays idle without an auth token instead of logging a transport failure", () => {
    localStorage.removeItem("auth-storage");

    const client = new MarketWebSocketClient();
    client.subscribeMany(["NSE:NIFTY50-INDEX"], () => undefined);
    vi.advanceTimersByTime(30_000);

    expect(FakeWebSocket.instances).toHaveLength(0);
    client.destroy();
  });

  it("reconnects after an unexpected close and replays all subscriptions", () => {
    const client = new MarketWebSocketClient();
    client.subscribeMany(["NSE:NIFTY50-INDEX"], () => undefined);

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();
    expect(firstSocket.sent).toEqual([
      JSON.stringify({ action: "subscribe", symbols: ["NSE:NIFTY50-INDEX"] }),
    ]);

    firstSocket.emitClose(1006, "network drop");
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const replacementSocket = FakeWebSocket.instances[1];
    replacementSocket.open();
    expect(replacementSocket.sent).toEqual([
      JSON.stringify({ action: "subscribe", symbols: ["NSE:NIFTY50-INDEX"] }),
    ]);

    client.destroy();
  });

  it("reconnects with a rotated auth token even when symbols are unchanged", () => {
    const client = new MarketWebSocketClient();
    client.subscribeMany(["NSE:NIFTY50-INDEX"], () => undefined);
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();

    client.updateAuthToken("fresh-token");
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("token=fresh-token");
    client.destroy();
  });

  it("reconnects when browser heartbeats work but market data stays silent", () => {
    const client = new MarketWebSocketClient();
    client.subscribeMany(["NSE:NIFTY50-INDEX"], () => undefined);
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();

    vi.advanceTimersByTime(60_000);
    expect(firstSocket.readyState).toBe(FakeWebSocket.CLOSED);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.destroy();
  });

  it("suspends on pagehide and resumes the retained subscription set on pageshow", () => {
    const client = new MarketWebSocketClient();
    client.subscribeMany(["NSE:NIFTY50-INDEX"], () => undefined);
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.open();

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(0);

    expect(FakeWebSocket.instances).toHaveLength(2);
    const replacementSocket = FakeWebSocket.instances[1];
    replacementSocket.open();
    expect(replacementSocket.sent).toContain(
      JSON.stringify({ action: "subscribe", symbols: ["NSE:NIFTY50-INDEX"] }),
    );

    client.destroy();
  });
});
