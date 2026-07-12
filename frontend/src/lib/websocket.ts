import { MarketTick } from "@/types/market";

type TickHandler = (tick: MarketTick) => void;

class MockWebSocketClient {
  private url: string;
  private apiKey: string;
  private subscribers: Map<string, Set<TickHandler>> = new Map();
  private mockInterval: any = null;
  private prices: Map<string, number> = new Map();

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
    this.startMockFeed();
  }

  subscribe(symbol: string, handler: TickHandler) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol)!.add(handler);
    
    // Immediately fire an initial tick
    const tick = this.generateTick(symbol);
    handler(tick);
  }

  unsubscribe(symbol: string, handler: TickHandler) {
    const handlers = this.subscribers.get(symbol);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(symbol);
      }
    }
  }

  private startMockFeed() {
    this.mockInterval = setInterval(() => {
      this.subscribers.forEach((handlers, symbol) => {
        const tick = this.generateTick(symbol);
        handlers.forEach((h) => h(tick));
      });
    }, 1000);
  }

  private generateTick(symbol: string): MarketTick {
    // Determine base price
    let basePrice = 22000;
    let isOption = false;
    let isPut = false;
    let strike = 22000;
    let underlyingSymbol = "NIFTY";

    if (symbol.includes("BANKNIFTY")) {
      basePrice = 48000;
      underlyingSymbol = "BANKNIFTY";
    } else if (symbol.includes("FINNIFTY")) {
      basePrice = 20000;
      underlyingSymbol = "FINNIFTY";
    } else if (symbol.includes("MIDCPNIFTY")) {
      basePrice = 10500;
      underlyingSymbol = "MIDCPNIFTY";
    } else if (symbol.includes("NIFTY")) {
      basePrice = 22000;
      underlyingSymbol = "NIFTY";
    }

    if (symbol !== underlyingSymbol) {
      isOption = true;
      isPut = symbol.endsWith("PE");
      // Try to parse strike price from symbol (e.g., NIFTY26Jul22000CE -> 22000)
      const match = symbol.match(/(\d+)(?:CE|PE)$/);
      if (match) {
        strike = parseInt(match[1], 10);
      }
    }

    // Get or initialize current price
    let currentPrice = this.prices.get(symbol);
    if (!currentPrice) {
      if (!isOption) {
        currentPrice = basePrice;
      } else {
        // Option pricing approximation
        const underlyingPrice = this.prices.get(underlyingSymbol) || basePrice;
        const diff = isPut ? strike - underlyingPrice : underlyingPrice - strike;
        const intrinsicValue = Math.max(0, diff);
        currentPrice = intrinsicValue + 50 + Math.random() * 100; // Intrinsic + time value
      }
      this.prices.set(symbol, currentPrice);
    }

    // Random walk update
    const pctChange = (Math.random() - 0.5) * (isOption ? 0.02 : 0.001); // Options fluctuate more
    currentPrice = currentPrice * (1 + pctChange);
    
    // Ensure option price doesn't go below zero
    if (isOption && currentPrice < 1.0) {
      currentPrice = 1.0 + Math.random() * 5;
    }
    this.prices.set(symbol, currentPrice);

    const change = currentPrice - basePrice; // simple relative to baseline
    const changePercent = (change / basePrice) * 100;

    return {
      trading_symbol: symbol,
      last_price: parseFloat(currentPrice.toFixed(2)),
      volume: Math.floor(100000 + Math.random() * 900000),
      open_interest: Math.floor(500000 + Math.random() * 2000000),
      timestamp: Date.now(),
      change: parseFloat(change.toFixed(2)),
      change_percent: parseFloat(changePercent.toFixed(2)),
    };
  }

  destroy() {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
    }
  }
}

// Singleton instances for WebSocket connections
const instances: Record<string, MockWebSocketClient> = {};

export function getWebSocket(url: string, apiKey: string) {
  const key = `${url}-${apiKey}`;
  if (!instances[key]) {
    instances[key] = new MockWebSocketClient(url, apiKey);
  }
  return instances[key];
}
