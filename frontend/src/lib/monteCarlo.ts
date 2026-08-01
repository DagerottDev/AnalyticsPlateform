import { StrategyLeg } from "@/lib/strategy";
import { timeToExpiry, DEFAULT_RISK_FREE_RATE } from "@/lib/optionMath";

export interface MonteCarloResult { probabilityOfProfit: number; expectedPnl: number; p05: number; p95: number; bins: { start: number; end: number; count: number }[]; samples: number; }

function normal(seed: number): [number, number] { const a = ((seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; const b = (((seed + 1) * 1664525 + 1013904223) >>> 0) / 2 ** 32; return [Math.sqrt(-2 * Math.log(Math.max(a, 1e-12))) * Math.cos(2 * Math.PI * b), seed + 2]; }

export function simulateStrategyPnl(
  legs: StrategyLeg[],
  spot: number,
  samples = 2000,
  valuationTimeMs = Date.now(),
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
): MonteCarloResult | null {
  const valid = legs.filter((leg): leg is StrategyLeg & { instrument: NonNullable<StrategyLeg["instrument"]> } => !!leg.instrument && !!leg.instrument.strike && !!leg.instrument.option_type && !!leg.instrument.expiry && leg.iv > 0);
  if (!valid.length || spot <= 0) return null;
  const timeToExpiryByLeg = new Map(valid.map((leg) => [leg.id, timeToExpiry(leg.instrument.expiry, valuationTimeMs)]));
  let seed = 42; const pnl: number[] = [];
  for (let i = 0; i < samples; i++) { const [z, next] = normal(seed); seed = next; pnl.push(valid.reduce((sum, leg) => { const T = timeToExpiryByLeg.get(leg.id)!; const strike = leg.instrument.strike!; const terminal = spot * Math.exp((riskFreeRate - .5 * leg.iv ** 2) * T + leg.iv * Math.sqrt(T) * z); const intrinsic = leg.instrument.option_type === "CE" ? Math.max(0, terminal - strike) : Math.max(0, strike - terminal); return sum + (intrinsic - leg.entryPrice) * leg.quantity * (leg.action === "Buy" ? 1 : -1); }, 0)); }
  pnl.sort((a,b) => a-b); const min=pnl[0], max=pnl.at(-1)!; const width=Math.max((max-min)/20, .01); const bins=Array.from({length:20},(_,i)=>({start:min+i*width,end:min+(i+1)*width,count:0})); pnl.forEach(value=>bins[Math.min(19,Math.floor((value-min)/width))].count++);
  return { probabilityOfProfit: pnl.filter(value=>value>0).length/samples*100, expectedPnl:pnl.reduce((a,b)=>a+b,0)/samples, p05:pnl[Math.floor(samples*.05)], p95:pnl[Math.floor(samples*.95)], bins, samples };
}
