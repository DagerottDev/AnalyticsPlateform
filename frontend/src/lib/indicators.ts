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

