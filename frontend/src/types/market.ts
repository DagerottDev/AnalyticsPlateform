export interface Instrument {
  trading_symbol: string;
  symbol: string;
  instrument_type: string;
  expiry: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  exchange: string;
}

export interface ExpiryList {
  expiries: string[];
}

export interface InstrumentResponse {
  instruments: Instrument[];
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
}
