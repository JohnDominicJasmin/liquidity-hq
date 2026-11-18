/* THE ON-CHAIN SCORES ARE COMPUTED HERE, NOT BY THE MODEL (owner sweep 2026-11-18). The prompt told the model to score a missing metric as
 * 50 ("neutral") and to do the weighted arithmetic itself, so a read with no data looked like a measured middle, and the composite was
 * whatever sum the model wrote. Now a missing metric stays null, each dimension averages only what was found, and the composite
 * re-weights over the dimensions that exist (null when fewer than two do). Same bands and weights the prompt states. Pure, for tests. */

const band = (v: number, cuts: Array<[number, number]>, last: number): number => {
  for (const [upTo, score] of cuts) if (v < upTo) return score;
  return last;
};

export function mvrvScore(v: number): number { return band(v, [[0.8, 100], [1.5, 80], [2.5, 55], [3.5, 25]], 5); }
export function soprScore(v: number): number { return band(v, [[0.97, 95], [1.0, 75], [1.02, 55], [1.06, 30]], 10); }
export function nvtScore(v: number): number { return band(v, [[50, 90], [75, 70], [110, 50], [150, 25]], 5); }
export function activityScore(addresses: number): number {
  return addresses > 1_000_000 ? 95 : addresses >= 800_000 ? 75 : addresses >= 600_000 ? 55 : addresses >= 400_000 ? 35 : 15;
}
export function flowScore(flow: unknown): number | null {
  return flow === 'OUTFLOW' ? 70 : flow === 'NEUTRAL' ? 50 : flow === 'INFLOW' ? 30 : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export interface OnchainScores {
  valuation_score: number | null; activity_score: number | null; capital_flow_score: number | null; whale_score: number | null;
  composite_score: number | null; verdict: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | null;
}

export function scoreOnchain(m: Record<string, unknown>): OnchainScores {
  const mvrv = num(m.mvrv), sopr = num(m.sopr), nvt = num(m.nvt), addr = num(m.active_addresses);
  const valuation = avg([mvrv != null ? mvrvScore(mvrv) : null, sopr != null ? soprScore(sopr) : null, nvt != null ? nvtScore(nvt) : null].filter((x): x is number => x != null));
  const activity = addr != null && addr > 0 ? activityScore(addr) : null;
  const flow = flowScore(m.exchange_flow);
  /* Whale behaviour has no single metric; the model's 0-100 judgement is kept only when it is a number in range. */
  const w = num(m.whale_score);
  const whale = w != null && w >= 0 && w <= 100 ? Math.round(w) : null;

  const parts: Array<[number | null, number]> = [[valuation, 0.30], [activity, 0.25], [flow, 0.25], [whale, 0.20]];
  const have = parts.filter((p): p is [number, number] => p[0] != null);
  const weight = have.reduce((s, [, wt]) => s + wt, 0);
  const composite = have.length >= 2 && weight > 0 ? Math.round(have.reduce((s, [v, wt]) => s + v * wt, 0) / weight) : null;
  const verdict = composite == null ? null : composite >= 65 ? 'BULLISH' : composite <= 40 ? 'BEARISH' : 'NEUTRAL';
  return { valuation_score: valuation, activity_score: activity, capital_flow_score: flow, whale_score: whale, composite_score: composite, verdict };
}
