import type { Instrument } from "@/types/market";

export interface OpenInterestStrike {
  strike: number;
  callOi: number;
  putOi: number;
  callChange: number;
  putChange: number;
}

export interface OpenInterestLevel {
  strike: number;
  openInterest: number;
  sessionChange: number;
}

export interface OpenInterestAnalysis {
  strikes: OpenInterestStrike[];
  totalCallOi: number;
  totalPutOi: number;
  totalCallChange: number;
  totalPutChange: number;
  putCallRatio: number | null;
  support: OpenInterestLevel | null;
  resistance: OpenInterestLevel | null;
  strongestPutAddition: OpenInterestLevel | null;
  strongestCallAddition: OpenInterestLevel | null;
  maxPain: number | null;
}

function finiteValue(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function maxLevel(
  rows: OpenInterestStrike[],
  value: (row: OpenInterestStrike) => number,
  change: (row: OpenInterestStrike) => number
): OpenInterestLevel | null {
  const winner = rows.reduce<OpenInterestStrike | null>((best, row) =>
    best === null || value(row) > value(best) ? row : best,
  null);
  if (!winner || value(winner) <= 0) return null;
  return {
    strike: winner.strike,
    openInterest: value(winner),
    sessionChange: change(winner),
  };
}

/**
 * Converts an option-chain snapshot into an OI profile. Fyers' `oich` is
 * the current trading-session change against the previous close, which is
 * the closest broker-supplied opening baseline available to the app.
 */
export function analyzeOpenInterest(
  instruments: Instrument[],
  spot: number
): OpenInterestAnalysis {
  const byStrike = new Map<number, OpenInterestStrike>();

  instruments.forEach((instrument) => {
    if (typeof instrument.strike !== "number" || !instrument.option_type) return;
    const row = byStrike.get(instrument.strike) ?? {
      strike: instrument.strike,
      callOi: 0,
      putOi: 0,
      callChange: 0,
      putChange: 0,
    };

    if (instrument.option_type === "CE") {
      row.callOi = finiteValue(instrument.oi);
      row.callChange = finiteValue(instrument.oi_change);
    }
    if (instrument.option_type === "PE") {
      row.putOi = finiteValue(instrument.oi);
      row.putChange = finiteValue(instrument.oi_change);
    }
    byStrike.set(instrument.strike, row);
  });

  const strikes = Array.from(byStrike.values()).sort((left, right) => left.strike - right.strike);
  const totalCallOi = strikes.reduce((sum, row) => sum + row.callOi, 0);
  const totalPutOi = strikes.reduce((sum, row) => sum + row.putOi, 0);
  const totalCallChange = strikes.reduce((sum, row) => sum + row.callChange, 0);
  const totalPutChange = strikes.reduce((sum, row) => sum + row.putChange, 0);
  const supportRows = strikes.filter((row) => row.strike <= spot);
  const resistanceRows = strikes.filter((row) => row.strike >= spot);
  const maxPain = calculateMaxPain(strikes);

  return {
    strikes,
    totalCallOi,
    totalPutOi,
    totalCallChange,
    totalPutChange,
    putCallRatio: totalCallOi > 0 ? totalPutOi / totalCallOi : null,
    support: maxLevel(supportRows.length > 0 ? supportRows : strikes, (row) => row.putOi, (row) => row.putChange),
    resistance: maxLevel(resistanceRows.length > 0 ? resistanceRows : strikes, (row) => row.callOi, (row) => row.callChange),
    strongestPutAddition: maxLevel(strikes.filter((row) => row.putChange > 0), (row) => row.putChange, (row) => row.putChange),
    strongestCallAddition: maxLevel(strikes.filter((row) => row.callChange > 0), (row) => row.callChange, (row) => row.callChange),
    maxPain,
  };
}

/** A simple open-interest-only max-pain estimate. It is a reference level,
 * not a prediction and intentionally excludes volume, liquidity and IV. */
function calculateMaxPain(strikes: OpenInterestStrike[]): number | null {
  if (strikes.length === 0) return null;

  return strikes.reduce<{ strike: number; pain: number } | null>((best, settlement) => {
    const pain = strikes.reduce(
      (total, row) => total
        + Math.max(0, settlement.strike - row.strike) * row.callOi
        + Math.max(0, row.strike - settlement.strike) * row.putOi,
      0
    );
    return best === null || pain < best.pain ? { strike: settlement.strike, pain } : best;
  }, null)?.strike ?? null;
}
