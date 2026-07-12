import { useReplayStore } from "@/stores/replayStore";
import { Instrument, TickData } from "@/types/market";
import { calculateOptionPrice } from "./greeks";

let playbackInterval: any = null;
let currentStep = 0;

export function generateRandomWalk(startPrice: number, volatility: number, steps: number): number[] {
  const path: number[] = [startPrice];
  const dt = 1 / steps;
  const drift = 0.0;

  for (let i = 1; i < steps; i++) {
    const prev = path[i - 1];
    
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const exponent = (drift - 0.5 * volatility * volatility) * dt + volatility * Math.sqrt(dt) * z;
    const nextPrice = prev * Math.exp(exponent);
    path.push(parseFloat(nextPrice.toFixed(2)));
  }
  return path;
}

export function generateSessionTicks(
  symbol: string,
  startPrice: number,
  volatility: number,
  instruments: Instrument[]
): { allTicks: any[] } {
  const steps = 375;
  const spotPath = generateRandomWalk(startPrice, volatility, steps);
  const allTicks: any[] = [];

  for (let t = 0; t < steps; t++) {
    const spot = spotPath[t];
    const stepTicks: Record<string, TickData> = {};

    const spotChange = spot - startPrice;
    const spotChangePercent = (spotChange / startPrice) * 100;
    stepTicks[symbol] = {
      trading_symbol: symbol,
      last_price: spot,
      volume: 100000 + t * 500,
      open_interest: 0,
      timestamp: Date.now(),
      change: parseFloat(spotChange.toFixed(2)),
      change_percent: parseFloat(spotChangePercent.toFixed(2)),
    };

    instruments.forEach(inst => {
      if (!inst.strike || !inst.option_type || !inst.expiry) return;
      const K = inst.strike;
      const type = inst.option_type as "CE" | "PE";
      
      const daysLeft = Math.max(7 - t / 375, 0.001);
      const T_years = daysLeft / 365;

      const r = 0.10;
      const price = calculateOptionPrice(type, spot, K, T_years, r, volatility);
      
      const baselinePrice = calculateOptionPrice(type, startPrice, K, 7/365, r, volatility);
      const change = price - baselinePrice;
      const changePercent = baselinePrice > 0 ? (change / baselinePrice) * 100 : 0;

      const oi = 10000 + K * 5;
      const volume = 500 + t * 20;

      stepTicks[inst.trading_symbol] = {
        trading_symbol: inst.trading_symbol,
        last_price: parseFloat(price.toFixed(2)),
        volume,
        open_interest: oi,
        timestamp: Date.now(),
        change: parseFloat(change.toFixed(2)),
        change_percent: parseFloat(changePercent.toFixed(2)),
      };
    });

    allTicks.push(stepTicks);
  }

  return { allTicks };
}

export function stopPlayback() {
  if (playbackInterval) {
    clearTimeout(playbackInterval);
    playbackInterval = null;
  }
}

export function startPlayback(allTicks: any[], onComplete: () => void) {
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
