import { useReplayStore } from "@/stores/replayStore";
import { HistoricalCandle, getHistoricalCandles } from "@/lib/market";
import { Instrument, TickData } from "@/types/market";
import { calculateOptionPrice } from "./greeks";
import { timeToExpiry, DEFAULT_RISK_FREE_RATE, nearestStrikeTo } from "./optionMath";

let playbackInterval: ReturnType<typeof setTimeout> | null = null;
let currentStep = 0;

// Bounds how many option contracts get a real broker history fetch: only the
// nearest expiry, and only strikes within this many steps of the session's
// opening ATM strike. Fetching every listed contract (easily 100s across
// several expiries) would be slow and risks Fyers rate limits for a session
// that's mostly relevant near the money anyway. Strikes outside this window
// keep the synthetic Black-Scholes price already computed for them.
const REAL_PRICE_STRIKE_WINDOW = 10;
const REAL_PRICE_FETCH_CONCURRENCY = 4;

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
  volatility: number,
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
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
      source: "real",
    };

    instruments.forEach((inst) => {
      if (!inst.strike || !inst.option_type || !inst.expiry) return;
      const K = inst.strike;
      const type = inst.option_type as "CE" | "PE";

      const T = timeToExpiry(inst.expiry, atMs);
      const price = calculateOptionPrice(type, spot, K, T, riskFreeRate, volatility);

      const T0 = timeToExpiry(inst.expiry, startMs);
      const baselinePrice = calculateOptionPrice(type, startPrice, K, T0, riskFreeRate, volatility);
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
        source: "synthetic",
      };
    });

    allTicks.push(stepTicks);
  });

  return { allTicks };
}

export interface RealPriceCoverage {
  attempted: number;
  matched: number;
}

/** Runs `tasks` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Overlays real broker historical prices onto a synthetic replay session,
 * in place, for a bounded set of near-the-money contracts on the nearest
 * expiry. Fyers' historical-candle endpoint accepts option trading symbols
 * directly (see getHistoricalCandles), so real per-contract prices are
 * fetched the same way the underlying's candles are — this just wasn't
 * being attempted before, so every option was always modeled.
 *
 * Contracts with no real candle for a given tick (or no real data at all —
 * some contracts simply predate what Fyers retains) keep the synthetic
 * Black-Scholes price already in `allTicks` for that tick, so the session is
 * always fully populated either way.
 */
export async function enrichReplaySessionWithRealPrices(
  symbol: string,
  allTicks: Record<string, TickData>[],
  instruments: Instrument[],
  sessionDate: string,
  resolution: string
): Promise<RealPriceCoverage> {
  if (allTicks.length === 0) return { attempted: 0, matched: 0 };

  const eligible = instruments.filter((i) => i.strike && i.option_type && i.expiry);
  if (eligible.length === 0) return { attempted: 0, matched: 0 };

  const nearestExpiry = eligible
    .map((i) => i.expiry as string)
    .reduce((soonest, expiry) =>
      new Date(expiry).getTime() < new Date(soonest).getTime() ? expiry : soonest
    );

  const startSpot = allTicks[0][symbol]?.last_price;
  const strikesForExpiry = Array.from(
    new Set(eligible.filter((i) => i.expiry === nearestExpiry).map((i) => i.strike as number))
  ).sort((a, b) => a - b);
  const atmStrike = nearestStrikeTo(strikesForExpiry, startSpot ?? strikesForExpiry[0]);
  const atmIndex = strikesForExpiry.indexOf(atmStrike);
  const strikeWindow = new Set(
    strikesForExpiry.slice(
      Math.max(0, atmIndex - REAL_PRICE_STRIKE_WINDOW),
      atmIndex + REAL_PRICE_STRIKE_WINDOW + 1
    )
  );

  const targets = eligible.filter(
    (i) => i.expiry === nearestExpiry && strikeWindow.has(i.strike as number)
  );

  let matched = 0;
  await runWithConcurrency(
    targets.map((inst) => async () => {
      let candles: HistoricalCandle[];
      try {
        candles = await getHistoricalCandles(inst.trading_symbol, sessionDate, sessionDate, resolution);
      } catch {
        // Broker had no history for this specific contract (too illiquid,
        // predates its retention window, etc.) — leave the synthetic price.
        return;
      }
      if (candles.length === 0) return;

      const byTimestamp = new Map(candles.map((c) => [new Date(c.timestamp).getTime(), c]));
      const baselineClose = candles[0].close;
      let hitAny = false;

      allTicks.forEach((stepTicks) => {
        const existing = stepTicks[inst.trading_symbol];
        if (!existing) return;
        const real = byTimestamp.get(existing.timestamp);
        if (!real) return;

        hitAny = true;
        const change = real.close - baselineClose;
        stepTicks[inst.trading_symbol] = {
          ...existing,
          last_price: real.close,
          volume: real.volume,
          change: parseFloat(change.toFixed(2)),
          change_percent: baselineClose !== 0 ? parseFloat(((change / baselineClose) * 100).toFixed(2)) : 0,
          source: "real",
        };
      });

      if (hitAny) matched++;
    }),
    REAL_PRICE_FETCH_CONCURRENCY
  );

  return { attempted: targets.length, matched };
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
  // Keep the prepared timeline in the shared store. Consumers opened after
  // playback starts (notably the Option Greek workspace) can then render the
  // already-fed portion of the session instead of waiting for a new tick.
  store.setReplayTimeline(allTicks);

  const tickRunner = () => {
    const activeStore = useReplayStore.getState();

    if (!activeStore.isPlaying) return;

    currentStep++;
    if (currentStep >= allTicks.length) {
      stopPlayback();
      onComplete();
      return;
    }

    activeStore.setCurrentStep(currentStep);
    activeStore.setProgressPercentage((currentStep / allTicks.length) * 100);
  };

  const runLoop = () => {
    const activeStore = useReplayStore.getState();
    if (!activeStore.isActive) {
      playbackInterval = null;
      return;
    }
    if (activeStore.isPlaying) {
      tickRunner();
    }

    // tickRunner can finish the session and reset the store. Do not leave a
    // polling timeout behind after completion or a stop from another window.
    if (!useReplayStore.getState().isActive) {
      playbackInterval = null;
      return;
    }

    const interval = Math.max(10, 1000 / activeStore.speedMultiplier);
    playbackInterval = setTimeout(runLoop, interval);
  };

  playbackInterval = setTimeout(runLoop, 1000 / store.speedMultiplier);
}
