// Distribution detector - the mirror image of the Accumulation Tracker.
// Scores how strongly the footprints say big players are EXITING into strength
// (taking profit): sellers hitting bids while price is still up, open interest
// unwinding into the rally, top-trader positioning leaning out, retail still
// paying positive funding (buying what the whales are selling), and heavy
// sell-side volume.
//
// Pure module - no React, no fetch - shared by the Dashboard card, the Arena
// chip + AI context, and the server-side Telegram alert so all three surfaces
// apply exactly the same rules. Without wallet-level on-chain data this is an
// inference from derivatives + flow, not a literal "whale wallet moved" alert;
// the run-up gate keeps it from firing on ordinary red days.

export interface DistributionInputs {
  change24hPct:   number | null;   // 24h % move - distribution needs prior strength
  cvdDivergence:  'bullish' | 'bearish' | null;  // bearish = price up but net selling
  takerBuyRatio:  number | null;   // 0–1 · low = aggressive sellers hitting bids
  oiTrend:        'strong_up' | 'weak_up' | 'strong_down' | 'weak_down' | null;
  whaleLongRatio: number | null;   // top-trader dollar-weighted long share (0–1)
  fundingRatePct: number | null;   // funding in percent units (0.045 = +0.045%)
  volRatio:       number | null;   // current volume / 20-period average
  priceBelowVwap: boolean | null;  // still green on the day but trading under VWAP
}

export interface DistributionScore {
  score:   number;    // 0–100
  reasons: string[];
  label:   'Distribution' | 'Early distribution' | 'Quiet';
}

/* Gate: profit-taking is only meaningful after strength. Coins that haven't run
   have nothing for big players to take profit ON - no run-up, no signal. */
const MIN_RUNUP_PCT = 1.5;

export function computeDistributionScore(d: DistributionInputs): DistributionScore | null {
  if (d.change24hPct == null || d.change24hPct < MIN_RUNUP_PCT) return null;

  let score = 0;
  const reasons: string[] = [];

  // 1 - Sellers into strength (max 25): the classic distribution tell -
  //     price still rising while cumulative delta turns net-sell.
  if (d.cvdDivergence === 'bearish') { score += 25; reasons.push('Sellers into strength'); }

  // 2 - Aggressive sell flow (max 15): takers hitting bids while price is up
  if (d.takerBuyRatio != null) {
    if      (d.takerBuyRatio <= 0.40) { score += 15; reasons.push(`${Math.round((1 - d.takerBuyRatio) * 100)}% taker sells`); }
    else if (d.takerBuyRatio <= 0.46) { score += 10; reasons.push(`${Math.round((1 - d.takerBuyRatio) * 100)}% taker sells`); }
  }

  // 3 - Positions unwinding (max 20): open interest falling while price rises =
  //     winners closing longs into the rally, not fresh money entering
  if      (d.oiTrend === 'weak_up')   { score += 20; reasons.push('Longs exiting into rally'); }
  else if (d.oiTrend === 'weak_down') { score += 8;  reasons.push('Positions unwinding'); }

  // 4 - Whales leaning out (max 15): top-trader dollar-weighted positioning
  if (d.whaleLongRatio != null) {
    if      (d.whaleLongRatio <= 0.45) { score += 15; reasons.push(`Whales ${Math.round(d.whaleLongRatio * 100)}% long`); }
    else if (d.whaleLongRatio <= 0.48) { score += 9;  reasons.push(`Whales ${Math.round(d.whaleLongRatio * 100)}% long`); }
  }

  // 5 - Retail still euphoric (max 15): positive funding = crowd buying what
  //     the big players are selling to them
  if (d.fundingRatePct != null) {
    if      (d.fundingRatePct >= 0.03) { score += 15; reasons.push('Retail longs paying'); }
    else if (d.fundingRatePct >= 0.01) { score += 8;  reasons.push('Funding positive'); }
  }

  // 6 - Heavy sell-side volume (max 10): volume spike with sellers dominant
  if (d.volRatio != null && d.volRatio >= 1.5 && d.takerBuyRatio != null && d.takerBuyRatio <= 0.48) {
    score += 10; reasons.push(`Vol ${d.volRatio.toFixed(1)}x on sells`);
  }

  // 7 - VWAP lost (max 5): green on the day but distribution pushed price
  //     under the session's volume-weighted average
  if (d.priceBelowVwap === true) { score += 5; reasons.push('Lost VWAP'); }

  const capped = Math.min(100, score);
  const label: DistributionScore['label'] =
    capped >= 70 ? 'Distribution' : capped >= 45 ? 'Early distribution' : 'Quiet';

  return { score: capped, reasons, label };
}

export function distributionColor(score: number): string {
  return score >= 75 ? 'var(--red)' : score >= 60 ? 'var(--orange)' : 'var(--amber)';
}
