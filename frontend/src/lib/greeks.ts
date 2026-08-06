export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  // Second/third-order Greeks. Vanna/vomma/charm/speed/zomma/ultima are
  // mathematically identical for CE and PE under Black-Scholes (they're
  // derivatives of d1/d2, and delta_PE = delta_CE - 1 is a constant
  // offset, so its higher-order derivatives match the call's exactly).
  vanna: number;
  vomma: number;
  charm: number;
  speed: number;
  color: number;
  zomma: number;
  ultima: number;
}

// Standard Normal CDF (using Hasting's approximation)
function cumulativeNormal(x: number): number {
  const a1 = 0.319381530;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const L = Math.abs(x);
  const k = 1.0 / (1.0 + 0.2316419 * L);
  const cnd = 1.0 - 1.0 / Math.sqrt(2 * Math.PI) * Math.exp(-L * L / 2) *
    (a1 * k + a2 * Math.pow(k, 2) + a3 * Math.pow(k, 3) + a4 * Math.pow(k, 4) + a5 * Math.pow(k, 5));
  
  if (x < 0) {
    return 1.0 - cnd;
  }
  return cnd;
}

export const normCDF = cumulativeNormal;

// Standard Normal PDF
function normalPDF(x: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

// Black-Scholes Option Pricing
export function calculateOptionPrice(
  type: "CE" | "PE",
  S: number, // Spot price
  K: number, // Strike price
  T: number, // Time to expiry in years
  r: number, // Risk-free interest rate (e.g. 0.10)
  sigma: number // Volatility (decimal, e.g. 0.15)
): number {
  if (T <= 0) {
    return type === "CE" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  if (sigma <= 0) {
    return type === "CE" ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  if (type === "CE") {
    return S * cumulativeNormal(d1) - K * Math.exp(-r * T) * cumulativeNormal(d2);
  } else {
    return K * Math.exp(-r * T) * cumulativeNormal(-d2) - S * cumulativeNormal(-d1);
  }
}

// Calculate option Greeks
export function calculateGreeks(
  type: "CE" | "PE",
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): Greeks {
  const greeks: Greeks = {
    price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
    vanna: 0, vomma: 0, charm: 0, speed: 0, color: 0, zomma: 0, ultima: 0,
  };

  greeks.price = calculateOptionPrice(type, S, K, T, r, sigma);

  if (T <= 0 || sigma <= 0) {
    greeks.delta = type === "CE" ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return greeks;
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  // Delta
  if (type === "CE") {
    greeks.delta = cumulativeNormal(d1);
  } else {
    greeks.delta = cumulativeNormal(d1) - 1;
  }

  // Gamma (same for CE/PE)
  greeks.gamma = normalPDF(d1) / (S * sigma * Math.sqrt(T));

  // Vega (same for CE/PE) - scaled for 1% change in vol
  greeks.vega = (S * normalPDF(d1) * Math.sqrt(T)) / 100;

  // Theta - scaled for 1 day change
  if (type === "CE") {
    const theta1 = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
    const theta2 = r * K * Math.exp(-r * T) * cumulativeNormal(d2);
    greeks.theta = (theta1 - theta2) / 365;
  } else {
    const theta1 = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
    const theta2 = r * K * Math.exp(-r * T) * cumulativeNormal(-d2);
    greeks.theta = (theta1 + theta2) / 365;
  }

  // Rho - scaled for 1% change in rates
  if (type === "CE") {
    greeks.rho = (K * T * Math.exp(-r * T) * cumulativeNormal(d2)) / 100;
  } else {
    greeks.rho = (-K * T * Math.exp(-r * T) * cumulativeNormal(-d2)) / 100;
  }

  // Second/third-order Greeks. Identical for CE/PE under Black-Scholes
  // (see the Greeks interface comment). Scaling mirrors the first-order
  // Greeks above: vega/vanna/vomma/ultima are "per 1% vol move" (/100),
  // theta/charm/color are "per 1 day" (/365), gamma/speed/zomma are raw
  // (unscaled, matching gamma's own convention).
  const sqrtT = Math.sqrt(T);
  const vegaRaw = S * normalPDF(d1) * sqrtT; // unscaled vega (d(price)/d(sigma))

  // Vanna = d(delta)/d(sigma) = d(vega)/d(S)
  greeks.vanna = (-normalPDF(d1) * (d2 / sigma)) / 100;

  // Vomma (volga) = d(vega)/d(sigma)
  greeks.vomma = (vegaRaw * ((d1 * d2) / sigma)) / 100;

  // Charm = -d(delta)/d(T) — the minus sign expresses decay as time
  // passes (T counts down to expiry), matching theta's sign convention.
  const charmRaw =
    -normalPDF(d1) * ((2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT));
  greeks.charm = charmRaw / 365;

  // Speed = d(gamma)/d(S)
  greeks.speed = (-greeks.gamma / S) * (d1 / (sigma * sqrtT) + 1);

  // Color = -d(gamma)/d(T), same day-decay sign convention as charm.
  //
  // d(gamma)/d(T) = -pdf(d1)/(S*sigma*sqrtT) * [d1*(r+0.5*sigma^2)/(sigma*sqrtT) + (1-d1^2)/(2T)]
  // (derived directly from gamma = pdf(d1)/(S*sigma*sqrtT) via the quotient
  // rule and d(d1)/d(T) = (r+0.5*sigma^2)/(sigma*sqrtT) - d1/(2T); verified
  // against a central finite difference of gamma to ~1e-7 relative error
  // across randomized S/K/T/r/sigma). The previous formula here carried a
  // spurious `2*r*T` term — the dividend-yield (b != r) case of the
  // textbook Color formula, which doesn't apply since this codebase has no
  // dividend/cost-of-carry input — that made color wrong by several percent
  // whenever r*T was non-negligible. Keep this in sync with
  // backend/app/services/greeks.py's calculate_greeks.
  const colorRaw =
    (normalPDF(d1) / (S * sigma * sqrtT)) *
    ((d1 * (r + 0.5 * sigma * sigma)) / (sigma * sqrtT) + (1 - d1 * d1) / (2 * T));
  greeks.color = colorRaw / 365;

  // Zomma = d(gamma)/d(sigma)
  greeks.zomma = (greeks.gamma * (d1 * d2 - 1)) / sigma;

  // Ultima = d(vomma)/d(sigma)
  const ultimaRaw =
    (-vegaRaw / (sigma * sigma)) * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2);
  greeks.ultima = ultimaRaw / 100;

  return greeks;
}

// Implied Volatility via Newton-Raphson with bisection fallback
export function calculateImpliedVolatility(
  type: "CE" | "PE",
  S: number,
  K: number,
  T: number,
  r: number,
  marketPrice: number
): number {
  const maxIterations = 100;
  const precision = 1e-5;
  let sigma = 0.3; // starting guess (30% IV)

  // Quick sanity checks
  const intrinsic = type === "CE" ? Math.max(0, S - K) : Math.max(0, K - S);
  if (marketPrice <= intrinsic) {
    return 0; // Out of bounds / arbitrage condition
  }

  for (let i = 0; i < maxIterations; i++) {
    const price = calculateOptionPrice(type, S, K, T, r, sigma);
    const diff = price - marketPrice;
    
    if (Math.abs(diff) < precision) {
      return sigma;
    }

    const greeks = calculateGreeks(type, S, K, T, r, sigma);
    const vega = greeks.vega * 100; // un-scale it
    
    if (Math.abs(vega) < 1e-4) {
      break;
    }

    const nextSigma = sigma - diff / vega;
    if (nextSigma <= 0 || nextSigma > 5.0) {
      break;
    }
    sigma = nextSigma;
  }

  // Bisection Fallback
  let low = 1e-4;
  let high = 5.0;
  let mid = 0.3;
  for (let i = 0; i < maxIterations; i++) {
    mid = (low + high) / 2;
    const price = calculateOptionPrice(type, S, K, T, r, mid);
    const diff = price - marketPrice;

    if (Math.abs(diff) < precision) {
      return mid;
    }

    if (diff > 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return mid;
}

