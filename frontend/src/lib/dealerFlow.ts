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

/**
 * Fyers live ticks and quote snapshots do not include option OI. Prefer a
 * positive live value when a broker provides one, otherwise use the OI
 * captured with the option-chain instrument snapshot.
 */
export function resolveOpenInterest(liveOi: number | null | undefined, snapshotOi: number | null | undefined): number {
  if (typeof liveOi === "number" && Number.isFinite(liveOi) && liveOi > 0) {
    return liveOi;
  }
  if (typeof snapshotOi === "number" && Number.isFinite(snapshotOi) && snapshotOi > 0) {
    return snapshotOi;
  }
  return 0;
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

export function calculateContractVannaExposure(
  vanna: number,
  oi: number,
  spot: number,
  lotSize: number,
  optionType: "CE" | "PE"
): number {
  const sign = optionType === "CE" ? 1 : -1;
  return vanna * oi * lotSize * spot * sign;
}

export function calculateContractCharmExposure(
  charm: number,
  oi: number,
  lotSize: number,
  optionType: "CE" | "PE"
): number {
  const sign = optionType === "CE" ? 1 : -1;
  return charm * oi * lotSize * sign;
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
