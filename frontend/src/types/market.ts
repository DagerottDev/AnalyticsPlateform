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
}

/** A simulated tick produced by the Replay engine. */
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
