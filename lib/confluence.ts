// Confluence Score — combines signals that are already computed elsewhere on the
// Arena page into one weighted verdict, plus a separate macro/event risk overlay.
//
// Deliberately NOT one blended number: a technical score (EMA ribbon + order flow +
// multi-TF RSI) and a macro event ("FOMC in 40 minutes") operate on completely
// different scales and timeframes. Folding "CPI print in 2 hours" numerically into a
// per-coin technical score would produce fake precision — the technicals themselves
// haven't changed, only the risk of holding through the print has. So macro/event risk
// is surfaced as a separate caution flag that downgrades confidence in the technical
// verdict, the same way weakEdge downgrades the EMA Ribbon badge (see useEMAStrategy.ts).
//
// v1 scope: no candlestick/chart-pattern factor (would need a dedicated candle fetch
// this scorer doesn't have) and no news sentiment (headlines aren't tagged
// bullish/bearish anywhere in the codebase yet — would need Grok scoring with caching,
// a real v2 feature, not a keyword-matching stand-in).

import type { Bias } from '@/components/StopLossZone';

// Mirrors app/api/econ-calendar/route.ts's CalEvent — kept local rather than imported
// since that file is a server route (matches the convention in app/econ-calendar/page.tsx).
export type CalEvent = { name: string; type: string; isoDate: string; impact: string };

// Directional factors vote bull/bear and add to the weighted score. Penalty factors
// (chop, divergence) never vote a direction — they only shrink the final score toward
// 0 when active, reducing confidence without claiming to know which way price goes.
export interface DirectionalFactor { kind: 'directional'; label: string; dir: 'bull' | 'bear' | 'neutral'; weight: number }
export interface PenaltyFactor     { kind: 'penalty';     label: string; active: boolean; weight: number }
export type ConfluenceFactorInput = DirectionalFactor | PenaltyFactor;

export interface ConfluenceResult {
  score: number;    // -100..100
  verdict: 'STRONG_BULL' | 'LEANING_BULL' | 'MIXED' | 'LEANING_BEAR' | 'STRONG_BEAR';
  factors: ConfluenceFactorInput[];
}

const BULL_BEAR_WEIGHT_TOTAL = 30 + 25 + 20; // EMA ribbon + order flow + multi-TF RSI

export function computeConfluence(factors: ConfluenceFactorInput[]): ConfluenceResult {
  let bullW = 0, bearW = 0, penaltyW = 0;
  for (const f of factors) {
    if (f.kind === 'penalty') { if (f.active) penaltyW += f.weight; continue; }
    if (f.dir === 'bull') bullW += f.weight;
    else if (f.dir === 'bear') bearW += f.weight;
  }
  let raw = ((bullW - bearW) / BULL_BEAR_WEIGHT_TOTAL) * 100;
  // Penalties pull the score toward 0 (reduce confidence) without flipping direction.
  const shrink = Math.max(0, 1 - penaltyW / 100);
  raw *= shrink;
  const score = Math.max(-100, Math.min(100, Math.round(raw)));

  const verdict: ConfluenceResult['verdict'] =
    score >= 60  ? 'STRONG_BULL' :
    score >= 25  ? 'LEANING_BULL' :
    score <= -60 ? 'STRONG_BEAR' :
    score <= -25 ? 'LEANING_BEAR' : 'MIXED';

  return { score, verdict, factors };
}

/* ── Order Flow bias → confluence factor ── */
export function orderFlowFactor(bias: Bias): DirectionalFactor {
  return { kind: 'directional', label: 'Order Flow Setup', dir: bias === 'long' ? 'bull' : bias === 'short' ? 'bear' : 'neutral', weight: 25 };
}

/* ── Multi-TF RSI alignment (15m/1h/4h) → confluence factor — same thresholds as
   components/MultiTFAlignment.tsx so the two cards never silently disagree. ── */
export function multiTfRsiFactor(rsi14: number | null, rsi1h: number | null, rsi4h: number | null): DirectionalFactor {
  const dir = (r: number | null) => r == null ? 0 : r > 57 ? 1 : r < 43 ? -1 : 0;
  const sum = dir(rsi14) + dir(rsi1h) + dir(rsi4h);
  return { kind: 'directional', label: 'Multi-TF RSI Alignment', dir: sum > 0 ? 'bull' : sum < 0 ? 'bear' : 'neutral', weight: 20 };
}

/* ── Macro / event risk overlay — separate from the score above ── */
export interface MacroRisk {
  level: 'none' | 'caution' | 'danger';
  reasons: string[];
}

const EVENT_DANGER_MS = 30 * 60_000;
const EVENT_CAUTION_MS = 2 * 3600_000;

export function computeMacroRisk(events: CalEvent[], jpyUsd: number | null, nowMs: number = Date.now()): MacroRisk {
  const reasons: string[] = [];
  let level: MacroRisk['level'] = 'none';

  const upcoming = events
    .map(e => ({ e, ms: new Date(e.isoDate).getTime() - nowMs }))
    .filter(x => x.ms >= -5 * 60_000 && x.ms <= EVENT_CAUTION_MS) // include events up to 5min past (release lag)
    .sort((a, b) => a.ms - b.ms);

  if (upcoming.length > 0) {
    const { e, ms } = upcoming[0];
    const mins = Math.round(ms / 60_000);
    const when = mins <= 0 ? 'releasing now' : mins < 60 ? `in ${mins}m` : `in ${(mins / 60).toFixed(1)}h`;
    if (ms <= EVENT_DANGER_MS) {
      level = 'danger';
      reasons.push(`${e.name} ${when} — expect a volatility spike`);
    } else {
      level = 'caution';
      reasons.push(`${e.name} ${when} — reduce size or wait`);
    }
  }

  if (jpyUsd != null) {
    if (jpyUsd >= 160) {
      level = 'danger';
      reasons.push(`USD/JPY ${jpyUsd.toFixed(1)} — BOJ intervention risk, carry-trade unwind can trigger BTC liquidations`);
    } else if (jpyUsd >= 158 && level !== 'danger') {
      level = 'caution';
      reasons.push(`USD/JPY ${jpyUsd.toFixed(1)} — approaching the 160 carry-trade danger zone`);
    }
  }

  return { level, reasons };
}
