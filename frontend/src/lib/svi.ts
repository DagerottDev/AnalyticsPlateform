/** Constrained raw-SVI smile calibration in total-variance space. */
export interface SviPoint { strike: number; iv: number; }
export interface SviModel { a: number; b: number; rho: number; m: number; sigma: number; rmse: number; }

function variance(model: Omit<SviModel, "rmse">, k: number): number {
  const x = k - model.m;
  return model.a + model.b * (model.rho * x + Math.sqrt(x * x + model.sigma * model.sigma));
}

/** Fits the five raw-SVI parameters with bounded coordinate descent. */
export function fitSvi(points: SviPoint[], spot: number, timeToExpiry: number): SviModel | null {
  const clean = points.filter(p => p.strike > 0 && p.iv > 0 && Number.isFinite(p.iv));
  if (clean.length < 4 || spot <= 0 || timeToExpiry <= 0) return null;
  const samples = clean.map(p => ({ k: Math.log(p.strike / spot), w: p.iv * p.iv * timeToExpiry }));
  const atm = samples.reduce((best, point) => Math.abs(point.k) < Math.abs(best.k) ? point : best, samples[0]);
  let model = { a: Math.max(1e-8, atm.w * 0.5), b: Math.max(1e-6, atm.w), rho: 0, m: 0, sigma: 0.1 };
  const loss = (candidate: typeof model) => samples.reduce((sum, point) => {
    const error = variance(candidate, point.k) - point.w;
    return sum + error * error;
  }, 0);
  let bestLoss = loss(model);
  let steps = [atm.w * 0.25, atm.w * 0.5, 0.25, 0.1, 0.1];
  const names = ["a", "b", "rho", "m", "sigma"] as const;
  for (let iteration = 0; iteration < 80; iteration++) {
    let improved = false;
    names.forEach((name, index) => {
      for (const direction of [-1, 1]) {
        const candidate = { ...model, [name]: model[name] + direction * steps[index] };
        candidate.a = Math.max(1e-8, candidate.a);
        candidate.b = Math.max(1e-8, candidate.b);
        candidate.rho = Math.max(-0.999, Math.min(0.999, candidate.rho));
        candidate.sigma = Math.max(1e-5, candidate.sigma);
        const candidateLoss = loss(candidate);
        if (candidateLoss < bestLoss) { model = candidate; bestLoss = candidateLoss; improved = true; }
      }
    });
    if (!improved) steps = steps.map(step => step * 0.55);
    if (Math.max(...steps) < 1e-6) break;
  }
  const rmse = Math.sqrt(bestLoss / samples.length);
  return { ...model, rmse };
}

export function sviImpliedVolatility(model: SviModel, strike: number, spot: number, timeToExpiry: number): number {
  if (strike <= 0 || spot <= 0 || timeToExpiry <= 0) return 0;
  return Math.sqrt(Math.max(0, variance(model, Math.log(strike / spot)) / timeToExpiry));
}
