// Pure logic for the dashboard's "Market Read" hero - the single answer-first
// verdict that replaces the old RaidMeter + Smart Money Score + Sentiment
// Extremes stack. Kept framework-free so it's trivially testable and so the
// hero component stays presentation-only.
//
// Three inputs merged, each preserving its original math:
//  - Conditions score (0-100): session timing, day, Fear & Greed, funding
//    (was RaidMeter.calcRPM). Order-wall proximity was removed (#1651): on the
//    markets it was read for it was always "tight", so it carried no information.
//  - Smart Money (-N..+N): 6-signal composite, shown as one factor
//    (was SmartMoneyScore)
//  - Contrarian flag: fires only at sentiment extremes (was SentimentExtremesAlert)
import { classifyFunding, type MarketStore } from '@/lib/marketStore';
import { isGodTier, isPrime, isMonEvening, isLondon, isDead } from '@/lib/session';

export type Band = 'good' | 'mid' | 'weak';
export type FundingSide = 'pos' | 'neg' | 'neu';

export interface Factor { key: string; label: string; value: string; sub?: string }
export interface Contrarian { dir: 'bull' | 'bear'; label: string; count: number; desc: string }
export interface MarketRead {
  /* PENDING (#1494): Fear & Greed or funding has not loaded yet. There is no
     score, no band and no verdict then - only a "reading" line - because the
     old defaults (F&G 50, funding 'neu') scored as real, pessimistic inputs and
     a cold load read "Weak setup - better to wait" at 40/100 before any data
     existed. `missing` names what is still loading. */
  pending: boolean;
  missing: Array<'fng' | 'funding'>;
  score: number | null;
  band: Band | null;
  verdict: string;
  sub: string;
  factors: Factor[];
  fundingSide: FundingSide;    // effective side used (after any manual override)
  autoFundingSide: FundingSide; // what the data alone says
  contrarian: Contrarian | null;
}

/* ── Smart Money composite (from SmartMoneyScore, 6 signals ±2 each) ── */
export function computeSmartMoney(store: MarketStore) {
  const coin = store.coins[store.selectedCoin];
  const s: number[] = [];

  const cb = store.cbPremiumPct;
  if (cb != null) s.push(cb > 0.05 ? 2 : cb > 0.01 ? 1 : cb < -0.05 ? -2 : cb < -0.01 ? -1 : 0);

  const flow = store.btcExchangeNetFlow;
  if (flow != null) s.push(flow > 100 ? -2 : flow > 50 ? -1 : flow < -100 ? 2 : flow < -50 ? 1 : 0);

  const taker = coin?.takerBuyRatio;
  if (taker != null) { const b = Math.round(taker * 100); s.push(b >= 65 ? 2 : b >= 55 ? 1 : b <= 35 ? -2 : b <= 45 ? -1 : 0); }

  const oi = coin?.oiTrend;
  if (oi != null) s.push(oi === 'strong_up' ? 2 : oi === 'weak_up' ? 1 : oi === 'weak_down' ? -1 : -2);

  const fr = coin?.fundingRate;
  if (fr != null) { const p = fr * 100; s.push(p >= 0.05 ? -2 : p >= 0.02 ? -1 : p <= -0.03 ? 2 : p <= -0.01 ? 1 : 0); }

  const lr = coin?.longRatio;
  if (lr != null) { const l = Math.round(lr * 100); s.push(l >= 65 ? -2 : l >= 55 ? -1 : l <= 35 ? 2 : l <= 45 ? 1 : 0); }

  const total = s.reduce((a, b) => a + b, 0);
  const max = s.length * 2 || 12;
  const label = total >= 5 ? 'Bullish' : total >= 2 ? 'Leaning bull'
    : total <= -5 ? 'Bearish' : total <= -2 ? 'Leaning bear' : 'Neutral';
  return { total, max, label };
}

/* ── Contrarian flag (from SentimentExtremesAlert, fires at 2/3+) ── */
export function computeContrarian(store: MarketStore): Contrarian | null {
  const coin = store.coins[store.selectedCoin];
  if (!coin || store.fng == null || coin.fundingRate == null || coin.longRatio == null) return null;
  const fng = store.fng, fr = coin.fundingRate * 100, longPct = coin.longRatio * 100;
  const bear = [fng >= 75, fr >= 0.04, longPct >= 60].filter(Boolean).length;
  const bull = [fng <= 25, fr <= -0.02, longPct <= 40].filter(Boolean).length;
  if (bear < 2 && bull < 2) return null;
  const isBear = bear >= bull, count = isBear ? bear : bull;
  return {
    dir: isBear ? 'bear' : 'bull',
    count,
    label: isBear ? 'Longs overcrowded' : 'Shorts overcrowded',
    desc: isBear
      ? (count >= 3 ? 'All 3 crowd signals show heavy long positioning.' : '2 of 3 crowd signals show heavy long positioning.')
      : (count >= 3 ? 'All 3 crowd signals show heavy short positioning.' : '2 of 3 crowd signals show heavy short positioning.'),
  };
}

/* ── The full read ── */
/** `partial`: score WITHOUT a funding rate the selected coin does not have (a coin with no perpetual never gets one), taken out of the
 *  maximum as well as out of the sum. Off by default: the read then waits for funding (#1494). The dashboard turns it on once its wait is over (#1185 D1). A missing Fear & Greed
 *  still has no read: it is global and recovers on its own. */
export function computeMarketRead(store: MarketStore, manualFund: FundingSide | null = null, opts: { partial?: boolean } = {}): MarketRead {
  const coin = store.coins[store.selectedCoin];

  /* An input that has not loaded is not scored (#1494). "Unknown reads as no"
     is the defect class: `store.fng ?? 50` and a missing funding rate read as
     'neu' used to score as Neutral F&G (12/25) and neutral funding (8/30, the
     lowest funding score). F&G and funding are too central to the score to
     leave out, so the read waits for them. A manual funding override counts as
     the funding input - the visitor has supplied it. */
  const missing: Array<'fng' | 'funding'> = [];
  if (store.fng == null) missing.push('fng');
  if (coin?.fundingRate == null && manualFund == null) missing.push('funding');
  const fng = store.fng;

  const autoFundingSide: FundingSide = coin?.fundingRate != null ? classifyFunding(coin.fundingRate).rpm : 'neu';
  const fundingSide = manualFund ?? autoFundingSide;

  // Session detection MUST come from lib/session.ts, which anchors every
  // window to UTC. This block used to re-implement the same five windows
  // against the VIEWER'S local clock (`now.getHours()`), with thresholds that
  // were really wall-clock values in one fixed zone - so a trader in London hit the
  // "London Open" bonus at 15:00 London time, which is the NY session, while
  // the actual London window (07:00-10:00 UTC) scored nothing. Silently wrong
  // for everyone in a different zone, with no label anywhere to hint at it.
  // The two copies had already drifted apart (session.ts London = 07:00-10:00
  // UTC vs 15:00-18:00 local here), which is exactly why this is a call now
  // and not a second copy.
  const now = new Date();
  let timeScore = 10;
  if (isGodTier(now))         timeScore = 30;
  else if (isPrime(now))      timeScore = 26;
  else if (isMonEvening(now)) timeScore = 22;
  else if (isLondon(now))     timeScore = 16;
  else if (isDead(now))       timeScore = 2;

  // Day-of-week scoring is anchored to UTC too - the session windows above
  // are UTC, so reading a local day here would disagree with them either side
  // of the viewer's midnight.
  const day = now.getUTCDay();
  const dayScore = [15, 14, 11, 10, 9, 4, 12][day];
  const dayLabel = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day];

  let fngScore = 12, fngLabel = 'Neutral';
  if (fng == null)    { fngScore = 0;  fngLabel = 'Reading…'; }
  else if (fng <= 15) { fngScore = 25; fngLabel = 'Extreme fear'; }
  else if (fng <= 30) { fngScore = 22; fngLabel = 'Fear'; }
  else if (fng <= 45) { fngScore = 18; fngLabel = 'Mild fear'; }
  else if (fng <= 55) { fngScore = 12; fngLabel = 'Neutral'; }
  else if (fng <= 70) { fngScore = 18; fngLabel = 'Greed'; }
  else if (fng <= 85) { fngScore = 22; fngLabel = 'High greed'; }
  else                { fngScore = 25; fngLabel = 'Extreme greed'; }

  const fundScore = fundingSide === 'neu' ? 8 : 30;
  const fundLabel = missing.includes('funding') ? 'Reading…'
    : fundingSide === 'pos' ? 'Long-heavy' : fundingSide === 'neg' ? 'Short-heavy' : 'Neutral';

  const fundingLeftOut = opts.partial === true && missing.includes('funding');
  /* What the read is still WAITING on: with funding left out it is only Fear & Greed. Equal to `missing` unless `partial` is on. */
  const waiting = fundingLeftOut ? missing.filter(m => m !== 'funding') : missing;
  const pending = waiting.length > 0;
  const raw = timeScore + dayScore + fngScore + (fundingLeftOut ? 0 : fundScore);
  const maxTotal = 30 + 15 + 25 + (fundingLeftOut ? 0 : 30);
  const score = pending ? null : Math.min(100, Math.round((raw / maxTotal) * 100));

  const band: Band | null = score == null ? null : score >= 70 ? 'good' : score >= 45 ? 'mid' : 'weak';
  const verdict = band == null ? 'Reading the market…'
    : band === 'good' ? 'Most signals agree'
    : band === 'mid' ? 'Signals are mixed'
    : 'Few signals agree';
  const sub = band == null
    ? `Waiting for ${waiting.map(m => (m === 'fng' ? 'Fear & Greed' : 'funding')).join(' and ')} data before giving a read.`
    : band === 'good'
    ? 'Several signals line up right now.'
    : band === 'mid'
    ? 'Signals point different ways right now.'
    : 'Few signals line up and momentum is unclear.';

  const sm = computeSmartMoney(store);

  const factors: Factor[] = [];
  factors.push({ key: 'fng', label: 'Fear & Greed', value: fngLabel, sub: fng == null ? undefined : String(fng) });
  /* The sub says how much the weekday adds to the score (out of 15), so the tile states why it is there (#1185). */
  factors.push({ key: 'day', label: 'Day', value: dayLabel, sub: `${dayScore}/15` });
  if (!fundingLeftOut) factors.push({ key: 'fund', label: 'Funding', value: fundLabel });
  /* A WORD ONLY, no "+1/10" (#1185, PM audit 2026-11-17): the denominator changed from one read to the next and nothing said what was counted. */
  factors.push({ key: 'sm', label: 'Smart money', value: sm.label });

  return { pending, missing: waiting, score, band, verdict, sub, factors, fundingSide, autoFundingSide, contrarian: computeContrarian(store) };
}
