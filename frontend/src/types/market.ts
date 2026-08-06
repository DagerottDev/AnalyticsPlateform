export interface Instrument {
  trading_symbol: string;
  symbol: string;
  instrument_type: string;
  expiry: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  exchange: string;
  /** Snapshotted from the option-chain fetch (~30s refresh), not live-ticking. */
  oi?: number | null;
  oi_change?: number | null;
  oi_change_percent?: number | null;
  /** Looked up live from the broker's symbol master, not a hardcoded
   * per-symbol table — null only if that lookup is temporarily unavailable. */
  lot_size?: number | null;
}

export interface ExpiryList {
  expiries: string[];
}

export interface InstrumentResponse {
  instruments: Instrument[];
}

export interface SymbolSuggestion {
  symbol: string;
  name: string;
}

export interface MarketTick {
  trading_symbol: string;
  last_price: number;
  volume: number;
  open_interest: number;
  timestamp: number;
  change: number;
  change_percent: number;
  /** Only populated by the REST quote snapshot/poller, not raw live ticks. */
  open_price?: number;
  high_price?: number;
  low_price?: number;
  prev_close_price?: number;
  ask?: number;
  bid?: number;
  atp?: number;
  /**
   * Provenance of the quote. The broker websocket and REST quote endpoint
   * share the same normalized shape, but only a websocket tick proves that
   * the broker is actively streaming outside the exchange's normal schedule.
   */
  feed?: "stream" | "snapshot";
  /** Timestamp of the most recent raw broker stream frame, when available. */
  last_stream_timestamp?: number;
  /** Only set during Replay Mode — see TickData.source. */
  source?: "real" | "synthetic";
}

/** A tick produced by the Replay engine, driven by real historical candles. */
export interface TickData {
  instrument_token?: number;
  trading_symbol: string;
  last_price: number;
  volume: number;
  open_interest: number;
  timestamp: number;
  change: number;
  change_percent: number;
  /**
   * Replay-only provenance: "real" when priced from the broker's own
   * historical candle for this exact contract, "synthetic" when no broker
   * history was available and the price was modeled with Black-Scholes off
   * the real spot instead. Absent on live (non-replay) ticks.
   */
  source?: "real" | "synthetic";
}
