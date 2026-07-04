// Kelly criterion sizing for binary contracts (prediction-market shares that
// cost `price` and pay $1 if correct, $0 otherwise).
//
// For a YES share priced at p (0-1) with true win probability q, the Kelly
// fraction of bankroll to stake is:
//   f* = (q - p) / (1 - p)
// Derivation: net odds b = (1-p)/p (profit per $1 staked if correct), and the
// standard Kelly formula f* = (b*q - (1-q)) / b simplifies to (q-p)/(1-p).

export type TradeSide = 'YES' | 'NO' | 'NONE';

export interface KellyInputs {
  modelProb: number;   // model's probability the market resolves YES, 0-1
  marketProb: number;  // market's current YES price as a probability, 0-1
  costPct: number;     // fees + slippage + safety buffer, as a fraction of edge (0-1), e.g. 0.3 = 30%
}

export interface KellyResult {
  side: TradeSide;
  rawEdge: number;       // |modelProb - marketProb|, before costs
  netEdge: number;       // edge after subtracting costPct
  kellyFraction: number; // 0-1, fraction of bankroll for the chosen side
  tradePrice: number;    // price paid per share for the chosen side
}

export function computeKelly({ modelProb, marketProb, costPct }: KellyInputs): KellyResult {
  const yesEdge = modelProb - marketProb;
  const side: TradeSide = yesEdge > 0 ? 'YES' : yesEdge < 0 ? 'NO' : 'NONE';
  const rawEdge = Math.abs(yesEdge);
  const netEdge = rawEdge * (1 - costPct);

  if (side === 'NONE' || netEdge <= 0) {
    return { side: 'NONE', rawEdge, netEdge: Math.max(netEdge, 0), kellyFraction: 0, tradePrice: marketProb };
  }

  // For YES: f* = (q-p)/(1-p). For NO: mirror with p'=1-marketProb.
  // effectiveQ - p reduces to exactly netEdge, so f* = netEdge / (1-p) —
  // this uses the after-cost edge rather than the raw model/market gap.
  const p = side === 'YES' ? marketProb : 1 - marketProb;
  const f = p >= 1 ? 0 : Math.max(0, netEdge / (1 - p));

  return {
    side,
    rawEdge,
    netEdge,
    kellyFraction: Math.min(f, 1),
    tradePrice: p,
  };
}

/** Applies a fractional-Kelly safety multiplier (e.g. 0.5 = half-Kelly). */
export function fractionalKelly(kellyFraction: number, multiplier: number): number {
  return Math.min(1, Math.max(0, kellyFraction * multiplier));
}
