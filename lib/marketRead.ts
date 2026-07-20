// Pure logic for the dashboard's "Market Read" hero - the single answer-first
// verdict that replaces the old RaidMeter + Smart Money Score + Sentiment
// Extremes stack. Kept framework-free so it's trivially testable and so the
// hero component stays presentation-only.
//
// Three inputs merged, each preserving its original math:
//  - Conditions score (0-100): session timing, day, Fear & Greed, funding,
//    order-wall proximity  (was RaidMeter.calcRPM)
//  - Smart Money (-N..+N): 6-signal composite, shown as one factor
//    (was SmartMoneyScore)
//  - Contrarian flag: fires only at sentiment extremes (was SentimentExtremesAlert)
import { classifyFunding, type MarketStore, type LiqWall } from '@/lib/marketStore';
import { getLocalNow } from '@/lib/session';

export type Band = 'good' | 'mid' | 'weak';
export type FundingSide = 'pos' | 'neg' | 'neu';

export interface Factor { key: string; label: string; value: string; sub?: string }
export interface Contrarian { dir: 'bull' | 'bear'; label: string; count: number; desc: string }
export interface MarketRead {
  score: number;
  band: Band;
  verdict: string;
  sub: string;
  factors: Factor[];
  fundingSide: FundingSide;    // effective side used (after any manual override)
  autoFundingSide: FundingSide; // what the data alone says
  contrarian: Contrarian | null;
}

/* ── Order-wall proximity (from RaidMeter) ── */
function wallProximity(price: number, bid: LiqWall[] | null, ask: LiqWall[] | null) {
  const has = bid !== null || ask !== null;
  if (!has || price <= 0) return { score: 0, label: '', pct: null as number | null, has: false };
  const all = [...(bid ?? []), ...(ask ?? [])];
  if (all.length === 0) return { score: 0, label: 'no walls', pct: null, has: true };
  const nearest = all.reduce((c, w) => (Math.abs(w.price - price) < Math.abs(c.price - price) ? w : c));
  const pct = (Math.abs(nearest.price - price) / price) * 100;
  let score = 0, label = '';
  if (pct <= 0.5)      { score = 30; label = `${pct.toFixed(2)}% away · tight`; }
  else if (pct <= 1.0) { score = 22; label = `${pct.toFixed(2)}% away · close`; }
  else if (pct <= 1.5) { score = 15; label = `${pct.toFixed(2)}% away`; }
  else if (pct <= 2.5) { score = 8;  label = `${pct.toFixed(2)}% away · far`; }
  else                 { score = 0;  label = `${pct.toFixed(1)}% · too far`; }
  return { score, label, pct, has: true };
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
      ? (count >= 3 ? 'All 3 crowd signals lean bearish - high flush risk. Tighten stops or wait.' : 'Crowd is leaning long - elevated flush risk. Avoid chasing longs.')
      : (count >= 3 ? 'All 3 crowd signals lean bullish - high squeeze potential. Watch for a sharp reversal.' : 'Crowd is leaning short - squeeze risk building. Watch for a reversal, not a buy yet.'),
  };
}

/* ── The full read ── */
export function computeMarketRead(store: MarketStore, manualFund: FundingSide | null = null): MarketRead {
  const coin = store.coins[store.selectedCoin];
  const fng = store.fng ?? 50;
  const price = coin?.price ?? 0;

  const autoFundingSide: FundingSide = coin?.fundingRate != null ? classifyFunding(coin.fundingRate).rpm : 'neu';
  const fundingSide = manualFund ?? autoFundingSide;

  const now = getLocalNow();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const isSunNight = (day === 0 && mins >= 1380) || (day === 1 && mins < 180);
  const isPrime = mins >= 120 && mins < 300;
  const isLondon = mins >= 900 && mins < 1080;
  const isDead = mins >= 720 && mins < 900;
  const isMonEve = day === 1 && mins >= 1200 && mins < 1380;
  let timeScore = 10;
  if (isSunNight) timeScore = 30; else if (isPrime) timeScore = 26; else if (isMonEve) timeScore = 22;
  else if (isLondon) timeScore = 16; else if (isDead) timeScore = 2;

  const dayScore = [15, 14, 11, 10, 9, 4, 12][day];
  const dayLabel = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day];

  let fngScore = 12, fngLabel = 'Neutral';
  if (fng <= 15)      { fngScore = 25; fngLabel = 'Extreme fear'; }
  else if (fng <= 30) { fngScore = 22; fngLabel = 'Fear'; }
  else if (fng <= 45) { fngScore = 18; fngLabel = 'Mild fear'; }
  else if (fng <= 55) { fngScore = 12; fngLabel = 'Neutral'; }
  else if (fng <= 70) { fngScore = 18; fngLabel = 'Greed'; }
  else if (fng <= 85) { fngScore = 22; fngLabel = 'High greed'; }
  else                { fngScore = 25; fngLabel = 'Extreme greed'; }

  const fundScore = fundingSide === 'neu' ? 8 : 30;
  const fundLabel = fundingSide === 'pos' ? 'Long-heavy' : fundingSide === 'neg' ? 'Short-heavy' : 'Neutral';

  const wall = wallProximity(price, coin?.orderBidWalls ?? null, coin?.orderAskWalls ?? null);

  const raw = timeScore + dayScore + fngScore + fundScore + wall.score;
  const maxTotal = 30 + 15 + 25 + 30 + (wall.has ? 30 : 0);
  const score = Math.min(100, Math.round((raw / maxTotal) * 100));

  const band: Band = score >= 70 ? 'good' : score >= 45 ? 'mid' : 'weak';
  const verdict = band === 'good' ? 'Good time to trade'
    : band === 'mid' ? 'Decent conditions - be selective'
    : 'Weak setup - better to wait';
  const sub = band === 'good'
    ? 'Several signals line up in your favor. A cleaner, higher-confidence window - still mind your risk.'
    : band === 'mid'
    ? 'Conditions are mixed but tradeable. Be picky with entries and keep your size modest.'
    : 'Signals are thin and momentum is unclear. No real edge right now - waiting is a position too.';

  const sm = computeSmartMoney(store);

  const factors: Factor[] = [];
  if (wall.has) factors.push({ key: 'wall', label: 'Order wall', value: wall.pct != null && wall.pct <= 1 ? 'Tight' : wall.label ? 'Nearby' : 'Far', sub: wall.label || undefined });
  factors.push({ key: 'fng', label: 'Fear & Greed', value: fngLabel, sub: String(fng) });
  factors.push({ key: 'day', label: 'Day', value: dayLabel });
  factors.push({ key: 'fund', label: 'Funding', value: fundLabel });
  factors.push({ key: 'sm', label: 'Smart money', value: sm.label, sub: `${sm.total > 0 ? '+' : ''}${sm.total}/${sm.max}` });

  return { score, band, verdict, sub, factors, fundingSide, autoFundingSide, contrarian: computeContrarian(store) };
}
