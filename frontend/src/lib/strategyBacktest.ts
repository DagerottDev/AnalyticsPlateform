import { calculateOptionPrice } from "@/lib/greeks";
import { DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";
import type { StrategyLeg } from "@/lib/strategy";

export interface BacktestCandle {
  timestamp: string;
  close: number;
}

export interface StrategyBacktestConfig {
  /** Number of trading sessions a simulated position stays open. */
  holdingDays: number;
  /** Fresh days-to-expiry assigned to each rolling simulated position. */
  daysToExpiry: number;
  /** Annual risk-free rate used for Black-Scholes fills. */
  riskFreeRate?: number;
}

export interface BacktestTrade {
  entryAt: string;
  exitAt: string;
  entrySpot: number;
  exitSpot: number;
  entryPremium: number;
  exitPremium: number;
  grossPremium: number;
  pnl: number;
  returnPct: number;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  pnl: number;
}

export interface StrategyBacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  averageTradePnl: number;
}

const DAYS_PER_YEAR = 252;

function rounded(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function validLegs(legs: StrategyLeg[]): StrategyLeg[] {
  return legs.filter((leg) =>
    leg.instrument?.strike &&
    leg.instrument.option_type &&
    leg.quantity > 0
  );
}

/**
 * Runs sequential, non-overlapping rolls of the current multi-leg strategy.
 * Underlying closes are historical observations; option fills are repriced at
 * each entry and exit using Black-Scholes because the persisted data store
 * contains underlying OHLCV, not a historical option-tick feed. Strikes are
 * held at their current moneyness so a 22,000 strike selected today becomes
 * the comparable strike on every historical entry date.
 */
export function runStrategyBacktest(
  legs: StrategyLeg[],
  currentSpot: number,
  candles: BacktestCandle[],
  config: StrategyBacktestConfig
): StrategyBacktestResult {
  const usableLegs = validLegs(legs);
  if (usableLegs.length === 0) throw new Error("Add at least one complete option leg before running a backtest.");
  if (!Number.isFinite(currentSpot) || currentSpot <= 0) throw new Error("A valid current spot price is required to normalize strikes.");
  if (!Number.isInteger(config.holdingDays) || config.holdingDays < 1) throw new Error("Holding period must be at least one trading day.");
  if (!Number.isInteger(config.daysToExpiry) || config.daysToExpiry < config.holdingDays) {
    throw new Error("Days to expiry must be at least the holding period.");
  }

  const cleaned = candles
    .filter((candle) => Number.isFinite(candle.close) && candle.close > 0 && !Number.isNaN(Date.parse(candle.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (cleaned.length <= config.holdingDays) {
    throw new Error("Not enough stored historical candles for the selected holding period.");
  }

  const rate = config.riskFreeRate ?? DEFAULT_RISK_FREE_RATE;
  const entryT = config.daysToExpiry / 365;
  const exitT = Math.max((config.daysToExpiry - config.holdingDays) / 365, 0.0001);
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for (let entryIndex = 0; entryIndex + config.holdingDays < cleaned.length; entryIndex += config.holdingDays) {
    const entry = cleaned[entryIndex];
    const exit = cleaned[entryIndex + config.holdingDays];
    let entryPremium = 0;
    let exitPremium = 0;
    let grossPremium = 0;

    for (const leg of usableLegs) {
      const instrument = leg.instrument!;
      const strike = instrument.strike! * (entry.close / currentSpot);
      const optionType = instrument.option_type!;
      const iv = Math.max(leg.iv || 0.2, 0.0001);
      const entryPrice = calculateOptionPrice(optionType, entry.close, strike, entryT, rate, iv);
      const exitPrice = calculateOptionPrice(optionType, exit.close, strike, exitT, rate, iv);
      const direction = leg.action === "Buy" ? 1 : -1;
      entryPremium += entryPrice * leg.quantity * direction;
      exitPremium += exitPrice * leg.quantity * direction;
      grossPremium += Math.abs(entryPrice * leg.quantity);
    }

    const pnl = exitPremium - entryPremium;
    const returnPct = (pnl / Math.max(grossPremium, 1)) * 100;
    equity += pnl;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity - equity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPct = Math.max(maxDrawdownPct, peakEquity > 0 ? (drawdown / peakEquity) * 100 : 0);
    trades.push({
      entryAt: entry.timestamp,
      exitAt: exit.timestamp,
      entrySpot: rounded(entry.close),
      exitSpot: rounded(exit.close),
      entryPremium: rounded(entryPremium),
      exitPremium: rounded(exitPremium),
      grossPremium: rounded(grossPremium),
      pnl: rounded(pnl),
      returnPct: rounded(returnPct),
    });
    equityCurve.push({ timestamp: exit.timestamp, equity: rounded(equity), pnl: rounded(pnl) });
  }

  const returns = trades.map((trade) => trade.returnPct / 100);
  const meanReturn = returns.reduce((total, value) => total + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((total, value) => total + (value - meanReturn) ** 2, 0) / Math.max(returns.length - 1, 1);
  const standardDeviation = Math.sqrt(variance);
  const sharpeRatio = standardDeviation > 0
    ? (meanReturn / standardDeviation) * Math.sqrt(DAYS_PER_YEAR / config.holdingDays)
    : 0;
  const totalPnl = trades.reduce((total, trade) => total + trade.pnl, 0);

  return {
    trades,
    equityCurve,
    totalPnl: rounded(totalPnl),
    sharpeRatio: rounded(sharpeRatio),
    maxDrawdown: rounded(maxDrawdown),
    maxDrawdownPct: rounded(maxDrawdownPct),
    winRate: rounded((trades.filter((trade) => trade.pnl > 0).length / Math.max(trades.length, 1)) * 100),
    averageTradePnl: rounded(totalPnl / Math.max(trades.length, 1)),
  };
}
