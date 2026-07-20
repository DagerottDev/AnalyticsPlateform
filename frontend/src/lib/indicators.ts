export interface OHLCVData {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorPoint {
  time: string | number;
  value: number;
}

export function calculateSMA(data: OHLCVData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({
      time: data[i].time,
      value: parseFloat((sum / period).toFixed(2))
    });
  }
  return result;
}

/** Weighted moving average of a raw numeric series (most recent value weighted highest). */
function wmaOfSeries(values: number[], period: number): number[] {
  const denom = (period * (period + 1)) / 2;
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - j] * (period - j);
    }
    result.push(sum / denom);
  }
  return result;
}

export function calculateWMA(data: OHLCVData[], period: number): IndicatorPoint[] {
  const closes = data.map(d => d.close);
  const values = wmaOfSeries(closes, period);
  return values.map((value, idx) => ({
    time: data[period - 1 + idx].time,
    value: parseFloat(value.toFixed(2)),
  }));
}

/** Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) — reduces lag vs a plain WMA/EMA. */
export function calculateHMA(data: OHLCVData[], period: number): IndicatorPoint[] {
  const halfPeriod = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const closes = data.map(d => d.close);

  const wmaHalf = wmaOfSeries(closes, halfPeriod); // aligned to index (halfPeriod-1)
  const wmaFull = wmaOfSeries(closes, period); // aligned to index (period-1)

  // Align both series to the same (later-starting) full-period index.
  const offset = period - halfPeriod;
  const rawHull: number[] = [];
  for (let i = 0; i < wmaFull.length; i++) {
    const halfValue = wmaHalf[i + offset];
    rawHull.push(2 * halfValue - wmaFull[i]);
  }

  const hull = wmaOfSeries(rawHull, sqrtPeriod);
  const startIdx = period - 1 + (sqrtPeriod - 1);
  return hull.map((value, idx) => ({
    time: data[startIdx + idx].time,
    value: parseFloat(value.toFixed(2)),
  }));
}

/** Volume Weighted Moving Average. */
export function calculateVWMA(data: OHLCVData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let pvSum = 0;
    let volSum = 0;
    for (let j = 0; j < period; j++) {
      const bar = data[i - j];
      const vol = bar.volume || 0;
      pvSum += bar.close * vol;
      volSum += vol;
    }
    result.push({
      time: data[i].time,
      value: parseFloat((volSum > 0 ? pvSum / volSum : data[i].close).toFixed(2)),
    });
  }
  return result;
}

/** Rolling mean and population standard deviation of closes over `period`. */
function rollingStats(data: OHLCVData[], period: number): { time: string | number; mean: number; stdDev: number }[] {
  const result: { time: string | number; mean: number; stdDev: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const mean = sum / period;

    let sumSqDiff = 0;
    for (let j = 0; j < period; j++) {
      const diff = data[i - j].close - mean;
      sumSqDiff += diff * diff;
    }
    result.push({ time: data[i].time, mean, stdDev: Math.sqrt(sumSqDiff / period) });
  }
  return result;
}

/** Z-score of the close price relative to its rolling mean/stddev. */
export function calculateZScore(data: OHLCVData[], period: number = 20): IndicatorPoint[] {
  return rollingStats(data, period).map(s => ({
    time: s.time,
    value: parseFloat((s.stdDev === 0 ? 0 : (data.find(d => d.time === s.time)!.close - s.mean) / s.stdDev).toFixed(4)),
  }));
}

export interface DonchianPoint {
  time: string | number;
  upper: number;
  middle: number;
  lower: number;
}

/** Donchian Channel: highest high / lowest low over `period`. */
export function calculateDonchian(data: OHLCVData[], period: number = 20): DonchianPoint[] {
  const result: DonchianPoint[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let upper = -Infinity;
    let lower = Infinity;
    for (let j = 0; j < period; j++) {
      upper = Math.max(upper, data[i - j].high);
      lower = Math.min(lower, data[i - j].low);
    }
    result.push({
      time: data[i].time,
      upper: parseFloat(upper.toFixed(2)),
      lower: parseFloat(lower.toFixed(2)),
      middle: parseFloat(((upper + lower) / 2).toFixed(2)),
    });
  }
  return result;
}

/** True Range series, one entry per bar from index 1 onward (needs a previous close). */
function trueRangeSeries(data: OHLCVData[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const highLow = data[i].high - data[i].low;
    const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
    const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }
  return tr;
}

/** Wilder's smoothing (same recurrence used for RSI's avgGain/avgLoss). */
function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  const result: number[] = [sum / period];
  for (let i = period; i < values.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + values[i]) / period);
  }
  return result;
}

/** Average True Range (Wilder's smoothing of True Range). */
export function calculateATR(data: OHLCVData[], period: number = 14): IndicatorPoint[] {
  const tr = trueRangeSeries(data);
  const atr = wilderSmooth(tr, period);
  // tr[0] corresponds to data[1]; wilderSmooth's first output uses tr[0..period-1] i.e. data[1..period]
  const startIdx = period;
  return atr.map((value, idx) => ({
    time: data[startIdx + idx].time,
    value: parseFloat(value.toFixed(2)),
  }));
}

/** Average Directional Index, plus the +DI/-DI lines used to compute it. */
export interface ADXPoint {
  time: string | number;
  adx: number;
  plusDI: number;
  minusDI: number;
}

export function calculateADX(data: OHLCVData[], period: number = 14): ADXPoint[] {
  if (data.length < period * 2 + 1) return [];

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const upMove = data[i].high - data[i - 1].high;
    const downMove = data[i - 1].low - data[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const highLow = data[i].high - data[i].low;
    const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
    const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
    tr.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }

  const smoothedTR = wilderSmooth(tr, period);
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];
  for (let i = 0; i < smoothedTR.length; i++) {
    const pDI = smoothedTR[i] === 0 ? 0 : (100 * smoothedPlusDM[i]) / smoothedTR[i];
    const mDI = smoothedTR[i] === 0 ? 0 : (100 * smoothedMinusDM[i]) / smoothedTR[i];
    plusDI.push(pDI);
    minusDI.push(mDI);
    const sum = pDI + mDI;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pDI - mDI)) / sum);
  }

  const adx = wilderSmooth(dx, period);
  // wilderSmooth(series, period)'s output[j] is "as of" series[period - 1 + j].
  // tr[]/plusDM[]/minusDM[] start at data[1], so smoothedTR[i]/plusDI[i]/dx[i]
  // is as of data[period + i]. adx[j] (wilderSmooth over dx) is therefore as
  // of data[period + (period - 1 + j)] = data[2*period - 1 + j].
  const adxStartIdx = 2 * period - 1;

  return adx.map((value, idx) => ({
    time: data[adxStartIdx + idx].time,
    adx: parseFloat(value.toFixed(2)),
    plusDI: parseFloat(plusDI[idx + period - 1].toFixed(2)),
    minusDI: parseFloat(minusDI[idx + period - 1].toFixed(2)),
  }));
}

export interface SupertrendPoint {
  time: string | number;
  value: number;
  trend: "up" | "down";
}

/** Supertrend: ATR-band trend-following overlay. */
export function calculateSupertrend(
  data: OHLCVData[],
  period: number = 10,
  multiplier: number = 3
): SupertrendPoint[] {
  const tr = trueRangeSeries(data);
  const atr = wilderSmooth(tr, period);
  const atrStartIdx = period; // matches calculateATR's alignment

  const result: SupertrendPoint[] = [];
  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevTrend: "up" | "down" = "up";

  for (let i = 0; i < atr.length; i++) {
    const barIdx = atrStartIdx + i;
    const bar = data[barIdx];
    const mid = (bar.high + bar.low) / 2;
    const basicUpper = mid + multiplier * atr[i];
    const basicLower = mid - multiplier * atr[i];

    let finalUpper = basicUpper;
    let finalLower = basicLower;

    if (i > 0) {
      const prevClose = data[barIdx - 1].close;
      finalUpper =
        basicUpper < prevFinalUpper || prevClose > prevFinalUpper ? basicUpper : prevFinalUpper;
      finalLower =
        basicLower > prevFinalLower || prevClose < prevFinalLower ? basicLower : prevFinalLower;
    }

    let trend: "up" | "down";
    if (i === 0) {
      trend = bar.close <= finalUpper ? "down" : "up";
    } else if (prevTrend === "down") {
      trend = bar.close > finalUpper ? "up" : "down";
    } else {
      trend = bar.close < finalLower ? "down" : "up";
    }

    const value = trend === "down" ? finalUpper : finalLower;
    result.push({ time: bar.time, value: parseFloat(value.toFixed(2)), trend });

    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevTrend = trend;
  }

  return result;
}

export function calculateEMA(data: OHLCVData[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (data.length < period) return [];
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let prevEma = sum / period;
  result.push({
    time: data[period - 1].time,
    value: parseFloat(prevEma.toFixed(2))
  });

  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    const curEma = data[i].close * k + prevEma * (1 - k);
    result.push({
      time: data[i].time,
      value: parseFloat(curEma.toFixed(2))
    });
    prevEma = curEma;
  }
  
  return result;
}

export function calculateRSI(data: OHLCVData[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (data.length <= period) return [];

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const firstRSI = 100 - 100 / (1 + firstRS);
  result.push({
    time: data[period].time,
    value: parseFloat(firstRSI.toFixed(2))
  });

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiValue = 100 - 100 / (1 + rs);
    result.push({
      time: data[i].time,
      value: parseFloat(rsiValue.toFixed(2))
    });
  }

  return result;
}

/** Stochastic RSI: a stochastic oscillator applied to RSI values, rather than price. 0-100 scale. */
export function calculateStochasticRSI(
  data: OHLCVData[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14
): IndicatorPoint[] {
  const rsi = calculateRSI(data, rsiPeriod);
  const result: IndicatorPoint[] = [];

  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    let highestRSI = -Infinity;
    let lowestRSI = Infinity;
    for (let j = 0; j < stochPeriod; j++) {
      const v = rsi[i - j].value;
      highestRSI = Math.max(highestRSI, v);
      lowestRSI = Math.min(lowestRSI, v);
    }
    const range = highestRSI - lowestRSI;
    const stochRsi = range === 0 ? 0 : ((rsi[i].value - lowestRSI) / range) * 100;
    result.push({ time: rsi[i].time, value: parseFloat(stochRsi.toFixed(2)) });
  }

  return result;
}

export interface BollingerBandsPoint {
  time: string | number;
  upper: number;
  middle: number;
  lower: number;
}

export function calculateBollingerBands(
  data: OHLCVData[],
  period: number = 20,
  multiplier: number = 2
): BollingerBandsPoint[] {
  const result: BollingerBandsPoint[] = [];
  const sma = calculateSMA(data, period);

  sma.forEach((smaPoint, idx) => {
    const dataIdx = idx + period - 1;
    const mid = smaPoint.value;

    let sumSqDiff = 0;
    for (let j = 0; j < period; j++) {
      const diff = data[dataIdx - j].close - mid;
      sumSqDiff += diff * diff;
    }
    const stdDev = Math.sqrt(sumSqDiff / period);
    
    result.push({
      time: smaPoint.time,
      upper: parseFloat((mid + multiplier * stdDev).toFixed(2)),
      middle: mid,
      lower: parseFloat((mid - multiplier * stdDev).toFixed(2)),
    });
  });

  return result;
}

