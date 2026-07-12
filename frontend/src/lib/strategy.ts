import { Instrument } from "@/types/market";
import { calculateOptionPrice, calculateGreeks, Greeks } from "./greeks";

export interface StrategyLeg {
  id: string;
  instrument: Instrument | null;
  action: "Buy" | "Sell";
  quantity: number;
  entryPrice: number;
  iv: number;
}

export interface PayoffPoint {
  strike: number;
  profitAtExpiry: number;
  profitT0: number;
}

export interface StrategyMetrics {
  maxProfit: number | "Unlimited";
  maxLoss: number | "Unlimited";
  breakevens: number[];
  riskRewardRatio: number | "N/A";
  winProbability: number;
}

export function calculatePayoffProfile(
  legs: StrategyLeg[],
  spotPrice: number,
  r: number = 0.10,
  T: number = 0.01,
  steps: number = 100
): PayoffPoint[] {
  if (legs.length === 0) return [];

  // Find range of strikes to plot
  const strikes = legs
    .map(l => l.instrument?.strike)
    .filter((s): s is number => typeof s === "number");
  
  const minStrike = strikes.length > 0 ? Math.min(...strikes) : spotPrice;
  const maxStrike = strikes.length > 0 ? Math.max(...strikes) : spotPrice;
  
  const range = maxStrike - minStrike || spotPrice * 0.10;
  const lowerBound = Math.max(0, minStrike - range * 0.5);
  const upperBound = maxStrike + range * 0.5;
  const stepSize = (upperBound - lowerBound) / steps;

  const points: PayoffPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const s = lowerBound + i * stepSize;
    let profitAtExpiry = 0;
    let profitT0 = 0;

    legs.forEach(leg => {
      if (!leg.instrument) return;
      const type = leg.instrument.option_type as "CE" | "PE";
      const K = leg.instrument.strike!;
      const q = leg.quantity;
      const entryPrice = leg.entryPrice;
      const multiplier = leg.action === "Buy" ? 1 : -1;

      // 1. Profit At Expiry (Intrinsic Value - Premium paid/received)
      let intrinsic = 0;
      if (type === "CE") {
        intrinsic = Math.max(0, s - K);
      } else {
        intrinsic = Math.max(0, K - s);
      }
      profitAtExpiry += (intrinsic - entryPrice) * q * multiplier;

      // 2. Profit T+0 (BS Value - Premium paid/received)
      const livePrice = calculateOptionPrice(type, s, K, T, r, leg.iv);
      profitT0 += (livePrice - entryPrice) * q * multiplier;
    });

    points.push({
      strike: parseFloat(s.toFixed(2)),
      profitAtExpiry: parseFloat(profitAtExpiry.toFixed(2)),
      profitT0: parseFloat(profitT0.toFixed(2)),
    });
  }

  return points;
}

export function calculateNetGreeks(legs: StrategyLeg[], spotPrice: number, T: number = 0.01, r: number = 0.10): any {
  const netGreeks = {
    delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
    netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, netRho: 0
  };
  
  legs.forEach(leg => {
    if (!leg.instrument || !leg.instrument.strike || !leg.instrument.option_type) return;
    const K = leg.instrument.strike;
    const type = leg.instrument.option_type as "CE" | "PE";
    const q = leg.quantity;
    const multiplier = leg.action === "Buy" ? 1 : -1;

    const greeks = calculateGreeks(type, spotPrice, K, T, r, leg.iv);
    netGreeks.delta += greeks.delta * q * multiplier;
    netGreeks.gamma += greeks.gamma * q * multiplier;
    netGreeks.theta += greeks.theta * q * multiplier;
    netGreeks.vega += greeks.vega * q * multiplier;
    netGreeks.rho += greeks.rho * q * multiplier;
  });

  netGreeks.netDelta = netGreeks.delta;
  netGreeks.netGamma = netGreeks.gamma;
  netGreeks.netTheta = netGreeks.theta;
  netGreeks.netVega = netGreeks.vega;
  netGreeks.netRho = netGreeks.rho;

  return netGreeks;
}


export function deriveMetricsFromProfile(profile: PayoffPoint[]): StrategyMetrics {
  if (profile.length === 0) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], riskRewardRatio: "N/A", winProbability: 50 };
  }

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  const breakevens: number[] = [];

  profile.forEach(p => {
    if (p.profitAtExpiry > maxProfit) maxProfit = p.profitAtExpiry;
    if (p.profitAtExpiry < maxLoss) maxLoss = p.profitAtExpiry;
  });

  // Simple breakeven detection: zero-crossing
  for (let i = 1; i < profile.length; i++) {
    const p1 = profile[i - 1];
    const p2 = profile[i];
    if ((p1.profitAtExpiry < 0 && p2.profitAtExpiry >= 0) || (p1.profitAtExpiry >= 0 && p2.profitAtExpiry < 0)) {
      const strike = p1.strike + (p2.strike - p1.strike) * (0 - p1.profitAtExpiry) / (p2.profitAtExpiry - p1.profitAtExpiry);
      breakevens.push(parseFloat(strike.toFixed(2)));
    }
  }

  const startP = profile[0].profitAtExpiry;
  const endP = profile[profile.length - 1].profitAtExpiry;
  const startSlope = profile[1].profitAtExpiry - profile[0].profitAtExpiry;
  const endSlope = profile[profile.length - 1].profitAtExpiry - profile[profile.length - 2].profitAtExpiry;

  let finalMaxProfit: number | "Unlimited" = maxProfit;
  let finalMaxLoss: number | "Unlimited" = maxLoss; // Keep negative

  if (startSlope < -1e-2 || endSlope > 1e-2) {
    finalMaxProfit = "Unlimited";
  }
  if (startSlope > 1e-2 || endSlope < -1e-2) {
    finalMaxLoss = "Unlimited";
  }

  // Risk reward ratio
  let rr: number | "N/A" = "N/A";
  if (typeof finalMaxProfit === "number" && typeof finalMaxLoss === "number" && finalMaxLoss !== 0) {
    rr = parseFloat((finalMaxProfit / Math.abs(finalMaxLoss)).toFixed(2));
  }

  // Mock Win probability based on profitable states
  let profitablePoints = 0;
  profile.forEach(p => {
    if (p.profitAtExpiry > 0) profitablePoints++;
  });
  const winProbability = Math.floor((profitablePoints / profile.length) * 100);

  return {
    maxProfit: finalMaxProfit === "Unlimited" ? "Unlimited" : parseFloat(finalMaxProfit.toFixed(2)),
    maxLoss: finalMaxLoss === "Unlimited" ? "Unlimited" : parseFloat(finalMaxLoss.toFixed(2)),
    breakevens,
    riskRewardRatio: rr,
    winProbability: winProbability || 35,
  };
}

