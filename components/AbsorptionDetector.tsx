'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { CoinId, BINANCE_SYMS, BYBIT_SYMS, computeFibLevels, useMarket } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

/* ── Types ── */
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; takerBuy: number }

export interface AbsorptionData {
  score:        number;                              // 0-100
  label:        'Strong' | 'Moderate' | 'Weak' | 'None';
  type:         'accumulation' | 'distribution' | null;
  duration:     number;                              // consecutive 15m absorption candles
  durationMin:  number;                              // duration × 15
  nearLevel:    string | null;                       // e.g. "at $104,200 bid wall"
  detail:       string;
  mtfConfirmed: boolean;                             // 1H also shows absorption
}

/* ── Per-candle classifier ── */
interface CandleClass {
  bodyRatio:    number;
  volRatio:     number;
  takerBuyPct:  number;
  isAbsorption: boolean;
  type:         'accumulation' | 'distribution' | null;
}

function classifyC(c: Candle, avgVol: number): CandleClass {
  const range       = Math.max(c.h - c.l, 1e-10);
  const bodyRatio   = Math.abs(c.c - c.o) / range;
  const volRatio    = avgVol > 0 ? c.v / avgVol : 1;
  const takerBuyPct = c.v > 0 ? (c.takerBuy / c.v) * 100 : 50;

  // Absorption = small body (price didn't move net) + elevated volume (lots of activity being absorbed)
  const isAbsorption = bodyRatio < 0.45 && volRatio > 1.2;

  const type: 'accumulation' | 'distribution' | null = isAbsorption
    ? takerBuyPct < 45   ? 'accumulation'   // sellers dominant but price holding - buyers absorbing sells
    : takerBuyPct > 55   ? 'distribution'   // buyers dominant but price not rising - sellers absorbing buys
    : 'accumulation'                         // balanced → default accumulation
    : null;

  return { bodyRatio, volRatio, takerBuyPct, isAbsorption, type };
}

/* ── Main analysis ─────────────────────────────────────────────────────────
   Scoring breakdown (max 100):
   • Body compression  (0–25): tight candle bodies = someone neutralising directional pressure
   • Volume elevation  (0–25): high volume = lots of orders being absorbed
   • Duration          (0–20): consecutive candles - the longer it holds the more loaded the coil
   • CVD alignment     (0–15): store's CVD divergence matches detected direction = confirmation
   • MTF 1H confirm    (0–15): same absorption pattern on 1H = institutional, not noise
──────────────────────────────────────────────────────────────────────────── */
function analyze(
  c15: Candle[],
  c1h: Candle[],
  cvdDiv:    string | null | undefined,
  bidWalls:  { price: number }[] | undefined,
  askWalls:  { price: number }[] | undefined,
  price:     number | undefined,
  hi:        number | undefined,
  lo:        number | undefined,
): AbsorptionData {
  const empty: AbsorptionData = {
    score: 0, label: 'None', type: null,
    duration: 0, durationMin: 0, nearLevel: null,
    detail: 'Insufficient data', mtfConfirmed: false,
  };
  if (c15.length < 15) return empty;

  // Baseline volume: use candles [-30, -5] to avoid contaminating baseline with current absorption
  const baseline = c15.slice(-30, -5);
  const avgVol   = baseline.reduce((s, c) => s + c.v, 0) / Math.max(baseline.length, 1);

  const recent = c15.slice(-12);
  const cls    = recent.map(c => classifyC(c, avgVol));

  // Consecutive absorption run from the most recent candle backwards
  let duration = 0;
  const tc = { accumulation: 0, distribution: 0 };
  for (let i = cls.length - 1; i >= 0; i--) {
    if (cls[i].isAbsorption) {
      duration++;
      if (cls[i].type) tc[cls[i].type!]++;
    } else break;
  }
  const domType: 'accumulation' | 'distribution' =
    tc.distribution > tc.accumulation ? 'distribution' : 'accumulation';
  const hasSignal = duration >= 2;

  // ── Score ──
  let score = 0;
  const last5 = cls.slice(-5);
  const last3 = cls.slice(-3);

  // 1. Body compression (0-25)
  const avgBody = last5.reduce((s, c) => s + c.bodyRatio, 0) / last5.length;
  score += Math.round(Math.max(0, (0.5 - avgBody) / 0.5) * 25);

  // 2. Volume elevation (0-25)
  const avgVR = last3.reduce((s, c) => s + c.volRatio, 0) / last3.length;
  score += Math.round(Math.min(Math.max(avgVR - 1, 0) / 1.5, 1) * 25);

  // 3. Duration (0-20)
  score += Math.round(Math.min(duration / 5, 1) * 20);

  // 4. CVD divergence alignment (0-15)
  let cvdOk = false;
  if (cvdDiv && hasSignal) {
    if (
      (cvdDiv === 'bullish' && domType === 'accumulation') ||
      (cvdDiv === 'bearish' && domType === 'distribution')
    ) { score += 15; cvdOk = true; }
  }

  // 5. MTF 1H confirmation (0-15)
  let mtfConfirmed = false;
  if (c1h.length >= 5) {
    const base1h = c1h.slice(-10, -2).reduce((s, c) => s + c.v, 0) / 8;
    const cls1h  = c1h.slice(-2).map(c => classifyC(c, base1h));
    mtfConfirmed = cls1h.some(c => c.isAbsorption);
    if (mtfConfirmed) score += 15;
  }

  score = Math.min(100, Math.max(0, score));
  const label: AbsorptionData['label'] =
    score >= 70 ? 'Strong' :
    score >= 45 ? 'Moderate' :
    score >= 20 ? 'Weak' : 'None';
  const type = score >= 20 && hasSignal ? domType : null;

  // ── Near level ──
  let nearLevel: string | null = null;
  if (price) {
    const checkW = (walls: { price: number }[] | undefined, side: string) => {
      if (!walls || nearLevel) return;
      for (const w of walls) {
        const d = Math.abs(price - w.price) / price * 100;
        if (d < 0.8) {
          nearLevel = `${d < 0.1 ? 'at' : d.toFixed(2) + '% from'} $${w.price.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${side} wall`;
          break;
        }
      }
    };
    checkW(bidWalls, 'bid');
    checkW(askWalls, 'ask');

    if (!nearLevel && hi && lo && hi > lo) {
      const fibs = computeFibLevels(hi, lo, price);
      if (fibs.length > 0) {
        const near = fibs.reduce((a, f) =>
          Math.abs(price - f.price) < Math.abs(price - a.price) ? f : a
        );
        const d = Math.abs(price - near.price) / price * 100;
        if (d < 0.5) nearLevel = `at ${near.label} fib ($${near.price.toLocaleString(undefined, { maximumFractionDigits: 0 })})`;
      }
    }
  }

  // ── Detail string ──
  const parts: string[] = [];
  if (duration > 0) {
    const m = duration * 15;
    const tStr = m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
    parts.push(`${duration} candles (~${tStr})`);
  }
  if (avgVR > 1.4) parts.push(`${avgVR.toFixed(1)}× avg vol`);
  if (cvdOk) parts.push('CVD ✓');
  if (mtfConfirmed) parts.push('1H ✓');

  return {
    score, label, type, duration,
    durationMin: duration * 15,
    nearLevel,
    detail: parts.join(' · ') || 'Low absorption activity',
    mtfConfirmed,
  };
}

/* ── Component ── */
interface Props { coin: CoinId; onData?: (d: AbsorptionData | null) => void }

export default function AbsorptionDetector({ coin, onData }: Props) {
  const { t } = useLabels();
  const { store }                 = useMarket();
  const [data, setData]           = useState<AbsorptionData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState('');
  const cbRef   = useRef(onData);
  const storeRef = useRef(store);
  useEffect(() => { cbRef.current   = onData; },  [onData]);
  useEffect(() => { storeRef.current = store; });   // always up-to-date, not a dep of load

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const binSym = BINANCE_SYMS[coin] as string | undefined;
      const bytSym = BYBIT_SYMS[coin]   as string | undefined;
      let c15: Candle[], c1h: Candle[];

      if (binSym) {
        const [r15, r1h] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=15m&limit=50`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=1h&limit=20`),
        ]);
        if (!r15.ok || !r1h.ok) throw new Error('Binance fetch failed');
        const raw15 = await r15.json() as (string | number)[][];
        const raw1h = await r1h.json() as (string | number)[][];
        c15 = raw15.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], takerBuy: +k[9] }));
        c1h = raw1h.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], takerBuy: +k[9] }));
      } else if (bytSym) {
        // Bybit klines don't include per-candle taker buy - use 50/50 split (still useful for body+vol)
        const toC = (k: string[]) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], takerBuy: +k[5] * 0.5 });
        const [r15, r1h] = await Promise.all([
          fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bytSym}&interval=15&limit=50`),
          fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bytSym}&interval=60&limit=20`),
        ]);
        if (!r15.ok || !r1h.ok) throw new Error('Bybit fetch failed');
        const raw15 = await r15.json() as { result?: { list?: string[][] } };
        const raw1h = await r1h.json() as { result?: { list?: string[][] } };
        c15 = [...(raw15?.result?.list ?? [])].reverse().map(toC);
        c1h = [...(raw1h?.result?.list ?? [])].reverse().map(toC);
      } else {
        throw new Error('No data source for ' + coin);
      }

      const cd = storeRef.current.coins[coin];
      const result = analyze(
        c15, c1h,
        cd?.cvdDivergence,
        cd?.orderBidWalls as { price: number }[] | undefined,
        cd?.orderAskWalls as { price: number }[] | undefined,
        cd?.price,
        cd?.high,
        cd?.low,
      );
      setData(result);
      cbRef.current?.(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      cbRef.current?.(null);
    } finally {
      setLoading(false);
    }
  }, [coin]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(iv);
  }, [load]);

  /* ── Loading skeleton ── */
  if (loading && !data) {
    return (
      <div className="abs-card" role="status" aria-live="polite">
        <span className="sr-only">{t('ABSORPTION_DETECTOR_LOADING_SR')}</span>
        <div className="abs-header">
          <span className="abs-title">{t('ABSORPTION_DETECTOR_TITLE')}</span>
          <SkeletonBar width={60} height={11} radius={4} />
        </div>
        <div className="abs-score-row">
          <SkeletonBar height={5} radius={3} style={{ flex: 1 }} />
          <SkeletonBar width={38} height={14} radius={3} />
          <SkeletonBar width={60} height={14} radius={3} />
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (err && !data) {
    return (
      <div className="abs-card">
        <div className="abs-header">
          <span className="abs-title">{t('ABSORPTION_DETECTOR_TITLE')}</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: '#f87171' }}>{t('ABSORPTION_DETECTOR_FAILED')}</span>
        </div>
      </div>
    );
  }

  const d       = data!;
  const typeCol = d.type === 'accumulation' ? '#34d399'
                : d.type === 'distribution' ? '#f87171'
                : '#9ca3af';
  const typeBg  = d.type === 'accumulation' ? 'rgba(52,211,153,0.10)'
                : d.type === 'distribution' ? 'rgba(248,113,113,0.10)'
                : 'rgba(156,163,175,0.06)';
  const barCol  = d.score >= 70 ? typeCol
                : d.score >= 45 ? '#fbbf24'
                : '#4b5563';

  return (
    <div className="abs-card">

      {/* ── Header ── */}
      <div className="abs-header">
        <span className="abs-title">{t('ABSORPTION_DETECTOR_TITLE')}</span>
        {d.type ? (
          <span className="abs-type-badge" style={{ color: typeCol, background: typeBg, border: `0.5px solid ${withAlpha(typeCol, '44')}` }}>
            {d.type === 'accumulation' ? t('ABSORPTION_DETECTOR_ACCUMULATION_BADGE') : t('ABSORPTION_DETECTOR_DISTRIBUTION_BADGE')}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fs-caption)', color: '#4b5563', fontWeight: 600 }}>{t('ABSORPTION_DETECTOR_NO_SIGNAL')}</span>
        )}
      </div>

      {/* ── Score bar ── */}
      <div className="abs-score-row">
        <div className="abs-score-track">
          <div className="abs-score-fill" style={{ width: d.score + '%', background: barCol }} />
        </div>
        <span className="abs-score-num" style={{ color: barCol }}>
          {d.score}<span className="abs-score-max">/100</span>
        </span>
        <span className="abs-label" style={{ color: barCol }}>{d.label}</span>
      </div>

      {/* ── Detail ── */}
      {d.label !== 'None' && d.detail && (
        <div className="abs-detail">{d.detail}</div>
      )}

      {/* ── Near level ── */}
      {d.nearLevel && (
        <div className="abs-level-row">
          <span className="abs-level-lbl">{t('ABSORPTION_DETECTOR_LEVEL_LABEL')}</span>
          <span className="abs-level-val">{d.nearLevel}</span>
        </div>
      )}

      {/* ── MTF badge ── */}
      {d.mtfConfirmed && (
        <div className="abs-mtf">
          <span className="abs-mtf-badge">{t('ABSORPTION_DETECTOR_MTF_BADGE')}</span>
          <span>{t('ABSORPTION_DETECTOR_MTF_TEXT')}</span>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="abs-footer">
        {t('ABSORPTION_DETECTOR_FOOTER')}
      </div>
    </div>
  );
}
