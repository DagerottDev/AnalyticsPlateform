import { useReplayStore } from "@/stores/replayStore";
import { HistoricalCandle } from "@/lib/market";
import { Instrument, TickData } from "@/types/market";
import { calculateOptionPrice } from "./greeks";
import { timeToExpiry, DEFAULT_RISK_FREE_RATE } from "./optionMath";

let playbackInterval: ReturnType<typeof setTimeout> | null = null;
let currentStep = 0;

/**
 * Builds a real-data replay session: the underlying's ticks come straight
 * from the broker's historical candles for the chosen date; each option
 * instrument's tick is priced off that real spot with Black-Scholes (the
 * same pricing engine used by the Strategy Builder/Greeks pages), since
 * Fyers doesn't expose historical tick data per option contract.
 */
export function buildReplaySession(
  symbol: string,
  candles: HistoricalCandle[],
  instruments: Instrument[],
  volatility: number
): { allTicks: Record<string, TickData>[] } {
  if (candles.length === 0) return { allTicks: [] };

  const startPrice = candles[0].close;
  const startMs = new Date(candles[0].timestamp).getTime();
  const allTicks: Record<string, TickData>[] = [];

  candles.forEach((candle) => {
    const spot = candle.close;
    const atMs = new Date(candle.timestamp).getTime();
    const stepTicks: Record<string, TickData> = {};

    const spotChange = spot - startPrice;
    const spotChangePercent = startPrice !== 0 ? (spotChange / startPrice) * 100 : 0;
    stepTicks[symbol] = {
      trading_symbol: symbol,
      last_price: spot,
      volume: candle.volume,
      open_interest: candle.open_interest,
      timestamp: atMs,
      change: parseFloat(spotChange.toFixed(2)),
      change_percent: parseFloat(spotChangePercent.toFixed(2)),
    };

    instruments.forEach((inst) => {
      if (!inst.strike || !inst.option_type || !inst.expiry) return;
      const K = inst.strike;
      const type = inst.option_type as "CE" | "PE";

      const T = timeToExpiry(inst.expiry, atMs);
      const price = calculateOptionPrice(type, spot, K, T, DEFAULT_RISK_FREE_RATE, volatility);

      const T0 = timeToExpiry(inst.expiry, startMs);
      const baselinePrice = calculateOptionPrice(type, startPrice, K, T0, DEFAULT_RISK_FREE_RATE, volatility);
      const change = price - baselinePrice;
      const changePercent = baselinePrice > 0 ? (change / baselinePrice) * 100 : 0;

      stepTicks[inst.trading_symbol] = {
        trading_symbol: inst.trading_symbol,
        last_price: parseFloat(price.toFixed(2)),
        volume: 0,
        open_interest: 0,
        timestamp: atMs,
        change: parseFloat(change.toFixed(2)),
        change_percent: parseFloat(changePercent.toFixed(2)),
      };
    });

    allTicks.push(stepTicks);
  });

  return { allTicks };
}

export function stopPlayback() {
  if (playbackInterval) {
    clearTimeout(playbackInterval);
    playbackInterval = null;
  }
}

export function startPlayback(allTicks: Record<string, TickData>[], onComplete: () => void) {
  stopPlayback();
  currentStep = 0;

  const store = useReplayStore.getState();
  store.setProgressPercentage(0);
  store.setCurrentTicks(allTicks[0]);

  const tickRunner = () => {
    const activeStore = useReplayStore.getState();

    if (!activeStore.isPlaying) return;

    currentStep++;
    if (currentStep >= allTicks.length) {
      stopPlayback();
      onComplete();
      return;
    }

    activeStore.setCurrentTicks(allTicks[currentStep]);
    activeStore.setProgressPercentage((currentStep / allTicks.length) * 100);
  };

  const runLoop = () => {
    const activeStore = useReplayStore.getState();
    if (activeStore.isPlaying) {
      tickRunner();
    }

    const interval = Math.max(10, 1000 / activeStore.speedMultiplier);
    playbackInterval = setTimeout(runLoop, interval);
  };

  playbackInterval = setTimeout(runLoop, 1000 / store.speedMultiplier);
}
