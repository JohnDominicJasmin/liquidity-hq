// Black-Scholes probability model for cash-or-nothing binary contracts
// (e.g. "BTC above $X by date Y" — the same shape as a Polymarket YES share).
// Given spot, strike, implied volatility and time to expiry, the model's
// probability that the underlying finishes above the strike is N(d2) — the
// same d2 used in the standard Black-Scholes option pricing formula.

export interface IVPoint { days: number; iv: number }

// Abramowitz & Stegun approximation — accurate to ~1e-7, no external deps.
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface BinaryProbInputs {
  spot: number;
  strike: number;
  daysToExpiry: number;
  ivPct: number;   // annualized implied volatility, e.g. 55 for 55%
}

export interface BinaryProbResult {
  probAbove: number;  // model probability underlying finishes > strike, 0-1
  d1: number;
  d2: number;
  T: number;          // years to expiry used in the calc
}

/** Risk-neutral probability (r=0) that spot finishes above strike at expiry. */
export function binaryCallProbability({ spot, strike, daysToExpiry, ivPct }: BinaryProbInputs): BinaryProbResult {
  const T = Math.max(daysToExpiry, 0.25) / 365.25; // floor at 6h to avoid 0/0
  const sigma = ivPct / 100;
  if (sigma <= 0 || spot <= 0 || strike <= 0) {
    return { probAbove: spot > strike ? 1 : 0, d1: 0, d2: 0, T };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { probAbove: normalCDF(d2), d1, d2, T };
}

/** Linear interpolation of ATM implied vol at an arbitrary days-to-expiry. */
export function interpolateIV(term: IVPoint[], days: number): number | null {
  if (!term.length) return null;
  const sorted = term;
  if (days <= sorted[0].days) return sorted[0].iv;
  const last = sorted[sorted.length - 1];
  if (days >= last.days) return last.iv;
  for (let i = 1; i < sorted.length; i++) {
    if (days <= sorted[i].days) {
      const a = sorted[i - 1], b = sorted[i];
      const t = (days - a.days) / (b.days - a.days);
      return a.iv + (b.iv - a.iv) * t;
    }
  }
  return last.iv;
}
