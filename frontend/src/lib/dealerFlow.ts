import { calculateGreeks } from "./greeks";

export interface StrikeExposure {
  strike: number;
  callExposure: number;
  putExposure: number;
  totalExposure: number;
  ceVanna?: number;
  peVanna?: number;
  netVanna?: number;
  ceCharm?: number;
  peCharm?: number;
  netCharm?: number;
}

export function getLotSize(symbol: string): number {
  if (!symbol) return 50;
  const clean = symbol.toUpperCase();
  if (clean.includes("BANKNIFTY")) return 15;
  if (clean.includes("FINNIFTY")) return 40;
  if (clean.includes("MIDCPNIFTY")) return 75;
  if (clean.includes("NIFTY")) return 50;
  return 50;
}

export function calculateContractGEX(
  gamma: number,
  oi: number,
  spot: number,
  lotSize: number,
  optionType: "CE" | "PE"
): number {
  const sign = optionType === "CE" ? 1 : -1;
  return gamma * oi * lotSize * spot * sign;
}

export function findGammaWalls(profile: StrikeExposure[]): { callWall: number; putWall: number } {
  let maxCall = -Infinity;
  let callWall = 0;
  let minPut = Infinity; // Find the most negative put exposure (which represents put wall)
  let putWall = 0;

  profile.forEach(p => {
    if (p.callExposure > maxCall) {
      maxCall = p.callExposure;
      callWall = p.strike;
    }
    if (p.putExposure < minPut) {
      minPut = p.putExposure;
      putWall = p.strike;
    }
  });

  return { callWall, putWall };
}

export function calculateZeroGamma(profile: StrikeExposure[]): number {
  let minAbsExp = Infinity;
  let zeroGammaStrike = 0;

  profile.forEach(p => {
    const absExp = Math.abs(p.totalExposure);
    if (absExp < minAbsExp) {
      minAbsExp = absExp;
      zeroGammaStrike = p.strike;
    }
  });

  return zeroGammaStrike;
}

export function calculateStrikeExposures(
  strikes: { strike: number; CE?: any; PE?: any }[],
  S: number,
  T: number,
  r: number,
  symbol: string
): StrikeExposure[] {
  return strikes.map(row => {
    let ceGex = 0, peGex = 0;
    let ceVanna = 0, peVanna = 0;
    let ceCharm = 0, peCharm = 0;

    const lotSize = getLotSize(symbol);

    if (row.CE) {
      const K = row.strike;
      const iv = 0.15; 
      const greeks = calculateGreeks("CE", S, K, T, r, iv);
      const oi = row.CE.open_interest || 0;
      
      ceGex = calculateContractGEX(greeks.gamma, oi, S, lotSize, "CE");
      ceVanna = greeks.delta * 0.5 * S * (oi * lotSize);
      ceCharm = greeks.theta * 0.1 * S * (oi * lotSize);
    }

    if (row.PE) {
      const K = row.strike;
      const iv = 0.15;
      const greeks = calculateGreeks("PE", S, K, T, r, iv);
      const oi = row.PE.open_interest || 0;
      
      peGex = calculateContractGEX(greeks.gamma, oi, S, lotSize, "PE");
      peVanna = -greeks.delta * 0.5 * S * (oi * lotSize);
      peCharm = -greeks.theta * 0.1 * S * (oi * lotSize);
    }

    return {
      strike: row.strike,
      callExposure: parseFloat(ceGex.toFixed(2)),
      putExposure: parseFloat(peGex.toFixed(2)),
      totalExposure: parseFloat((ceGex + peGex).toFixed(2)),
      ceVanna: parseFloat(ceVanna.toFixed(2)),
      peVanna: parseFloat(peVanna.toFixed(2)),
      netVanna: parseFloat((ceVanna + peVanna).toFixed(2)),
      ceCharm: parseFloat(ceCharm.toFixed(2)),
      peCharm: parseFloat(peCharm.toFixed(2)),
      netCharm: parseFloat((ceCharm + peCharm).toFixed(2)),
    };
  });
}
