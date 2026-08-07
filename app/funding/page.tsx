'use client';
import { useState, useEffect, useRef } from 'react';
import { COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_LABELS, type CoinId, useMarket } from '@/lib/marketStore';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import { Warn } from '@/components/icons';
import LoadingState from '@/components/LoadingState';
import Tip from '@/components/Tip';
import CoinIcon from '@/components/CoinIcon';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* ── types ── */
interface FRPoint { rate: number; ts: number; }
type FRHistory = Partial<Record<CoinId, FRPoint[]>>;


const RANGES = [
  { key: '24h', label: '24h', count: 3  },
  { key: '3d',  label: '3d',  count: 9  },
  { key: '7d',  label: '7d',  count: 21 },
  { key: '14d', label: '14d', count: 42 },
] as const;
type RangeKey = typeof RANGES[number]['key'];
const RANGE_LABEL_KEYS: Record<RangeKey, LabelKey> = {
  '24h': 'FUNDING_RANGE_24H',
  '3d':  'FUNDING_RANGE_3D',
  '7d':  'FUNDING_RANGE_7D',
  '14d': 'FUNDING_RANGE_14D',
};

/* ── data fetching ── */
async function fetchBinanceFR(sym: string): Promise<FRPoint[]> {
  try {
    const res  = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=42`);
    const data = await res.json();
    return (data as Array<{ fundingRate: string; fundingTime: number }>)
      .map(d => ({ rate: parseFloat(d.fundingRate), ts: d.fundingTime }))
      .sort((a, b) => a.ts - b.ts);
  } catch { return []; }
}

async function fetchBybitFR(sym: string): Promise<FRPoint[]> {
  try {
    const res  = await fetch(
      `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}&limit=42`,
    );
    const data = await res.json();
    return ((data?.result?.list ?? []) as Array<{ fundingRate: string; fundingRateTimestamp: string }>)
      .map(d => ({ rate: parseFloat(d.fundingRate), ts: parseInt(d.fundingRateTimestamp) }))
      .sort((a, b) => a.ts - b.ts);
  } catch { return []; }
}

/* ── formatting ── */
function frColor(r: number): string {
  if (r >= 0.0005) return 'var(--red)';
  if (r <= -0.0003) return 'var(--green-2)';
  return 'var(--txt-dim)';
}
function frFmt(r: number): string {
  return (r >= 0 ? '+' : '') + (r * 100).toFixed(4) + '%';
}

type FRSignalId =
  | 'longs_overcrowded' | 'longs_heavy' | 'longs_dominant' | 'slight_long'
  | 'balanced' | 'shorts_dominant' | 'shorts_crowded' | 'shorts_overcrowded';
interface FRSignal {
  id: FRSignalId;
  crowdKey: LabelKey; hintKey: LabelKey; labelKey: LabelKey; actionKey: LabelKey; descKey: LabelKey;
  color: string; bg: string;
}
function frSignal(r: number): FRSignal {
  const p = r * 100;
  if (p >= 0.05)  return {
    id: 'longs_overcrowded',
    crowdKey: 'FUNDING_SIG_LONGS_OVERCROWDED_CROWD', hintKey: 'FUNDING_SIG_LONGS_OVERCROWDED_HINT',
    labelKey: 'FUNDING_SIG_LONGS_OVERCROWDED_LABEL',
    color: 'var(--red)', bg: 'rgba(248,113,113,0.09)',
    actionKey: 'FUNDING_SIG_LONGS_OVERCROWDED_ACTION',
    descKey: 'FUNDING_SIG_LONGS_OVERCROWDED_DESC',
  };
  if (p >= 0.02)  return {
    id: 'longs_heavy',
    crowdKey: 'FUNDING_SIG_LONGS_HEAVY_CROWD', hintKey: 'FUNDING_SIG_LONGS_HEAVY_HINT',
    labelKey: 'FUNDING_SIG_LONGS_HEAVY_LABEL',
    color: 'var(--orange)', bg: 'rgba(251,146,60,0.08)',
    actionKey: 'FUNDING_SIG_LONGS_HEAVY_ACTION',
    descKey: 'FUNDING_SIG_LONGS_HEAVY_DESC',
  };
  if (p >= 0.01)  return {
    id: 'longs_dominant',
    crowdKey: 'FUNDING_SIG_LONGS_DOMINANT_CROWD', hintKey: 'FUNDING_SIG_LONGS_DOMINANT_HINT',
    labelKey: 'FUNDING_SIG_LONGS_DOMINANT_LABEL',
    color: 'var(--amber)', bg: 'rgba(251,191,36,0.07)',
    actionKey: 'FUNDING_SIG_LONGS_DOMINANT_ACTION',
    descKey: 'FUNDING_SIG_LONGS_DOMINANT_DESC',
  };
  if (p > 0.003)  return {
    id: 'slight_long',
    crowdKey: 'FUNDING_SIG_SLIGHT_LONG_CROWD', hintKey: 'FUNDING_SIG_SLIGHT_LONG_HINT',
    labelKey: 'FUNDING_SIG_SLIGHT_LONG_LABEL',
    color: '#d4b483', bg: 'rgba(212,180,131,0.06)',
    actionKey: 'FUNDING_SIG_SLIGHT_LONG_ACTION',
    descKey: 'FUNDING_SIG_SLIGHT_LONG_DESC',
  };
  if (p >= -0.003) return {
    id: 'balanced',
    crowdKey: 'FUNDING_SIG_BALANCED_CROWD', hintKey: 'FUNDING_SIG_BALANCED_HINT',
    labelKey: 'FUNDING_SIG_BALANCED_LABEL',
    color: 'var(--txt-dim)', bg: 'rgba(255,255,255,0.04)',
    actionKey: 'FUNDING_SIG_BALANCED_ACTION',
    descKey: 'FUNDING_SIG_BALANCED_DESC',
  };
  if (p >= -0.01)  return {
    id: 'shorts_dominant',
    crowdKey: 'FUNDING_SIG_SHORTS_DOMINANT_CROWD', hintKey: 'FUNDING_SIG_SHORTS_DOMINANT_HINT',
    labelKey: 'FUNDING_SIG_SHORTS_DOMINANT_LABEL',
    color: 'var(--green-soft)', bg: 'rgba(134,239,172,0.07)',
    actionKey: 'FUNDING_SIG_SHORTS_DOMINANT_ACTION',
    descKey: 'FUNDING_SIG_SHORTS_DOMINANT_DESC',
  };
  if (p >= -0.03)  return {
    id: 'shorts_crowded',
    crowdKey: 'FUNDING_SIG_SHORTS_CROWDED_CROWD', hintKey: 'FUNDING_SIG_SHORTS_CROWDED_HINT',
    labelKey: 'FUNDING_SIG_SHORTS_CROWDED_LABEL',
    color: 'var(--green-2)', bg: 'rgba(52,211,153,0.09)',
    actionKey: 'FUNDING_SIG_SHORTS_CROWDED_ACTION',
    descKey: 'FUNDING_SIG_SHORTS_CROWDED_DESC',
  };
  return {
    id: 'shorts_overcrowded',
    crowdKey: 'FUNDING_SIG_SHORTS_OVERCROWDED_CROWD', hintKey: 'FUNDING_SIG_SHORTS_OVERCROWDED_HINT',
    labelKey: 'FUNDING_SIG_SHORTS_OVERCROWDED_LABEL',
    color: 'var(--green-2)', bg: 'rgba(52,211,153,0.13)',
    actionKey: 'FUNDING_SIG_SHORTS_OVERCROWDED_ACTION',
    descKey: 'FUNDING_SIG_SHORTS_OVERCROWDED_DESC',
  };
}

/* ── canvas: sparkline ── */
function drawSparkline(canvas: HTMLCanvasElement, pts: FRPoint[]) {
  const W   = canvas.offsetWidth > 10 ? canvas.offsetWidth : 130;
  const H   = 36;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (pts.length < 2) return;

  const rates  = pts.map(p => p.rate);
  const maxAbs = Math.max(Math.max(...rates.map(Math.abs)), 0.00005);
  const yMid   = H / 2;
  const yScale = (yMid - 3) / maxAbs;
  const xs = (i: number) => (i / (rates.length - 1)) * W;
  const ys = (r: number) => yMid - r * yScale;

  /* positive fill (above zero) */
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, yMid); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(rates[0]));
  rates.forEach((r, i) => ctx.lineTo(xs(i), ys(r)));
  ctx.lineTo(xs(rates.length - 1), yMid);
  ctx.lineTo(xs(0), yMid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(248,113,113,0.28)';
  ctx.fill();
  ctx.restore();

  /* negative fill (below zero) */
  ctx.save();
  ctx.beginPath(); ctx.rect(0, yMid, W, H); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(rates[0]));
  rates.forEach((r, i) => ctx.lineTo(xs(i), ys(r)));
  ctx.lineTo(xs(rates.length - 1), yMid);
  ctx.lineTo(xs(0), yMid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(52,211,153,0.28)';
  ctx.fill();
  ctx.restore();

  /* zero line */
  ctx.beginPath();
  ctx.moveTo(0, yMid); ctx.lineTo(W, yMid);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  /* line */
  ctx.beginPath();
  rates.forEach((r, i) => i === 0 ? ctx.moveTo(xs(i), ys(r)) : ctx.lineTo(xs(i), ys(r)));
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  /* last dot */
  const last = rates[rates.length - 1];
  ctx.beginPath();
  ctx.arc(xs(rates.length - 1), ys(last), 2.5, 0, Math.PI * 2);
  ctx.fillStyle = last >= 0 ? '#f87171' : '#34d399';
  ctx.fill();
}

/* ── canvas: full chart ── */
function drawFullChart(canvas: HTMLCanvasElement, pts: FRPoint[]) {
  const PL = 52, PR = 14, PT = 14, PB = 28;
  const W   = canvas.offsetWidth > 50 ? canvas.offsetWidth : 320;
  const H   = 190;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const CW    = W - PL - PR;
  const CH    = H - PT - PB;
  const rates = pts.map(p => p.rate);
  const maxAbs = Math.max(Math.max(...rates.map(Math.abs)), 0.00005) * 1.2;
  const yMid   = PT + CH / 2;
  const yScale = (CH / 2) / maxAbs;
  const xs = (i: number) => PL + (i / Math.max(rates.length - 1, 1)) * CW;
  const ys = (r: number) => yMid - r * yScale;

  /* grid lines + Y labels */
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'right';
  const gridVals = [-0.001, -0.0005, 0, 0.0005, 0.001];
  gridVals.forEach(g => {
    const y = ys(g);
    if (y < PT - 4 || y > PT + CH + 4) return;
    ctx.beginPath();
    ctx.moveTo(PL, y); ctx.lineTo(W - PR, y);
    ctx.strokeStyle = g === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = g === 0 ? 1 : 0.5;
    ctx.stroke();
    ctx.fillStyle = g === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)';
    ctx.fillText((g * 100).toFixed(3) + '%', PL - 5, y);
  });

  /* positive fill */
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, CW, yMid - PT); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(rates[0]));
  rates.forEach((r, i) => ctx.lineTo(xs(i), ys(r)));
  ctx.lineTo(xs(rates.length - 1), yMid);
  ctx.lineTo(xs(0), yMid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(248,113,113,0.18)';
  ctx.fill();
  ctx.restore();

  /* negative fill */
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, yMid, CW, PT + CH - yMid); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(xs(0), ys(rates[0]));
  rates.forEach((r, i) => ctx.lineTo(xs(i), ys(r)));
  ctx.lineTo(xs(rates.length - 1), yMid);
  ctx.lineTo(xs(0), yMid);
  ctx.closePath();
  ctx.fillStyle = 'rgba(52,211,153,0.18)';
  ctx.fill();
  ctx.restore();

  /* line */
  ctx.beginPath();
  rates.forEach((r, i) => i === 0 ? ctx.moveTo(xs(i), ys(r)) : ctx.lineTo(xs(i), ys(r)));
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  /* dots at each point */
  rates.forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(xs(i), ys(r), i === rates.length - 1 ? 4 : 2, 0, Math.PI * 2);
    ctx.fillStyle = r >= 0 ? 'rgba(248,113,113,0.9)' : 'rgba(52,211,153,0.9)';
    ctx.fill();
    if (i === rates.length - 1) {
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  /* X-axis time labels */
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = 'rgba(255,255,255,0.25)';
  const skip = Math.max(1, Math.ceil(pts.length / 7));
  pts.forEach((p, i) => {
    if (i % skip !== 0 && i !== pts.length - 1) return;
    const d   = new Date(p.ts);
    const mo  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    // For 24h range show time, otherwise show date
    const label = pts.length <= 4 ? `${String(d.getHours()).padStart(2,'0')}:00` : `${mo} ${d.getDate()}`;
    ctx.fillText(label, xs(i), PT + CH + 7);
  });
}

/* ── component ── */
export default function FundingHistory() {
  const { t }                 = useLabels();
  const { store }             = useMarket();
  const [history, setHistory] = useState<FRHistory>({});
  const [selected, setSelected] = useState<CoinId>('btc');
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [loading, setLoading]   = useState(true);
  const [frSearch, setFrSearch] = useState('');

  const fullChartRef = useRef<HTMLCanvasElement>(null);
  const sparkRefs    = useRef<Partial<Record<CoinId, HTMLCanvasElement>>>({});

  const rangeCount = RANGES.find(r => r.key === rangeKey)!.count;

  /* fetch history for all coins on mount */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: FRHistory = {};
      await Promise.all(COINS.map(async id => {
        const binSym = (BINANCE_SYMS as Record<string, string>)[id];
        const bbSym  = (BYBIT_SYMS  as Record<string, string>)[id];
        let pts: FRPoint[] = [];
        if (binSym) pts = await fetchBinanceFR(binSym);
        if (!pts.length && bbSym) pts = await fetchBybitFR(bbSym);
        if (pts.length) result[id] = pts;
      }));
      if (!cancelled) { setHistory(result); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* redraw all sparklines when data or range changes */
  useEffect(() => {
    if (!Object.keys(history).length) return;
    requestAnimationFrame(() => {
      COINS.forEach(id => {
        const canvas = sparkRefs.current[id];
        if (!canvas) return;
        drawSparkline(canvas, (history[id] ?? []).slice(-rangeCount));
      });
    });
  }, [history, rangeCount]);

  /* redraw full chart when selection, range, or data changes */
  useEffect(() => {
    const canvas = fullChartRef.current;
    if (!canvas) return;
    const pts = (history[selected] ?? []).slice(-rangeCount);
    if (pts.length < 2) return;
    requestAnimationFrame(() => drawFullChart(canvas, pts));
  }, [history, selected, rangeCount]);

  function getStats(id: CoinId) {
    const pts = (history[id] ?? []).slice(-rangeCount);
    if (!pts.length) return null;
    const rates = pts.map(p => p.rate);
    const avg   = rates.reduce((a, b) => a + b, 0) / rates.length;
    const last  = rates[rates.length - 1];
    const first = rates[0];
    const trend = last > first + 0.00001 ? '↑' : last < first - 0.00001 ? '↓' : '→';
    const extremes = rates.filter(r => Math.abs(r) > 0.001).length;
    return { avg, trend, extremes };
  }

  const currentCoin = store.coins[selected];

  return (
    <div>

      {/* Header */}
      <div className="mb-header">
        <h1 className="mb-title">{t('FUNDING_PAGE_TITLE')}</h1>
        <div className="mb-subtitle">{t('FUNDING_PAGE_SUBTITLE')}</div>
      </div>

      {/* FR Regime Overview - live data from market store, no history needed */}
      {(() => {
        const liveCoins = COINS.map(id => {
          const fr = store.coins[id]?.fundingRate;
          if (fr == null) return null;
          const sig        = frSignal(fr);
          const p          = fr * 100;
          const carryArb   = Math.abs(p) > 0.03;
          const contraShort = sig.id === 'longs_overcrowded' || sig.id === 'longs_heavy';
          const contraLong  = sig.id === 'shorts_overcrowded' || sig.id === 'shorts_crowded';
          return { id, fr, sig, carryArb, contraShort, contraLong };
        }).filter((x): x is NonNullable<typeof x> => x !== null);

        const shortSignals = liveCoins.filter(c => c.contraShort);
        const longSignals  = liveCoins.filter(c => c.contraLong);
        const arbs         = liveCoins.filter(c => c.carryArb);

        if (!liveCoins.length) return null;

        return (
          <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 8 }}>
              <Tip width={250} text={t('FUNDING_REGIME_OVERVIEW_TIP')}>{t('FUNDING_REGIME_OVERVIEW_LABEL')}</Tip>
            </div>

            {/* Summary chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 'var(--fs-caption)', padding: '2px 7px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', color: 'var(--red)', border: '0.5px solid rgba(248,113,113,0.25)', fontWeight: 700 }}>
                <Tip iconColor="var(--red)" text={t('FUNDING_CONTRARIAN_SHORT_TIP')}>
                  {t('FUNDING_CONTRARIAN_SHORT_COUNT', { count: shortSignals.length, plural: shortSignals.length !== 1 ? 's' : '' })}
                </Tip>
              </span>
              <span style={{ fontSize: 'var(--fs-caption)', padding: '2px 7px', borderRadius: 10, background: 'rgba(52,211,153,0.10)', color: 'var(--green-2)', border: '0.5px solid rgba(52,211,153,0.25)', fontWeight: 700 }}>
                <Tip iconColor="var(--green-2)" text={t('FUNDING_CONTRARIAN_LONG_TIP')}>
                  {t('FUNDING_CONTRARIAN_LONG_COUNT', { count: longSignals.length, plural: longSignals.length !== 1 ? 's' : '' })}
                </Tip>
              </span>
              <span style={{ fontSize: 'var(--fs-caption)', padding: '2px 7px', borderRadius: 10, background: 'rgba(26,122,255,0.10)', color: 'var(--accent)', border: '0.5px solid rgba(26,122,255,0.25)', fontWeight: 700 }}>
                <Tip iconColor="#1a7aff" text={t('FUNDING_CARRY_ARB_TIP')}>
                  {t('FUNDING_CARRY_ARB_COUNT', { count: arbs.length })}
                </Tip>
              </span>
            </div>

            {/* Coin regime rows */}
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {liveCoins.map(({ id, fr, sig, carryArb, contraShort, contraLong }) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderTop: '0.5px solid var(--bdr)' }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: coinBadgeColor(id), minWidth: 32, flexShrink: 0, fontFamily: 'var(--font-mono), monospace' }}>
                    {id.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: frColor(fr), fontFamily: 'var(--font-mono), monospace', minWidth: 64, flexShrink: 0 }}>
                    {frFmt(fr)}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', padding: '1px 5px', borderRadius: 8, background: sig.bg, color: sig.color, border: `0.5px solid ${withAlpha(sig.color, '33')}`, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                    {t(sig.crowdKey)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {contraShort && (
                    <span style={{ fontSize: 'var(--fs-caption)', padding: '1px 5px', borderRadius: 3, background: 'rgba(248,113,113,0.12)', color: 'var(--red)', fontWeight: 700, flexShrink: 0 }}>
                      {t('FUNDING_BADGE_SHORT_LABEL')}
                    </span>
                  )}
                  {contraLong && (
                    <span style={{ fontSize: 'var(--fs-caption)', padding: '1px 5px', borderRadius: 3, background: 'rgba(52,211,153,0.12)', color: 'var(--green-2)', fontWeight: 700, flexShrink: 0 }}>
                      {t('FUNDING_BADGE_LONG_LABEL')}
                    </span>
                  )}
                  {carryArb && (
                    <span style={{ fontSize: 'var(--fs-caption)', padding: '1px 5px', borderRadius: 3, background: 'rgba(26,122,255,0.10)', color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
                      {t('FUNDING_BADGE_ARB_LABEL')}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {arbs.length > 0 && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 8, paddingTop: 6, borderTop: '0.5px solid var(--bdr)' }}>
                {t('FUNDING_CARRY_ARB_FOOTNOTE')}
              </div>
            )}
          </div>
        );
      })()}

      {/* Range selector */}
      <div className="frh-range-row">
        {RANGES.map(r => (
          <button
            key={r.key}
            className={`frh-range-btn${rangeKey === r.key ? ' on' : ''}`}
            onClick={() => setRangeKey(r.key)}
          >
            {t(RANGE_LABEL_KEYS[r.key])}
          </button>
        ))}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginLeft: 4, alignSelf: 'center', opacity: 0.6 }}>
          {t('FUNDING_RANGE_ROW_HINT')}
        </span>
      </div>

      {/* Loading state */}
      {loading && <LoadingState message={t('FUNDING_LOADING_MESSAGE')} />}

      {!loading && (() => {
        let longCnt = 0, shortCnt = 0, neutralCnt = 0;
        COINS.forEach(id => {
          const fr = store.coins[id]?.fundingRate;
          if (fr == null) return;
          if (fr * 100 > 0.003) longCnt++;
          else if (fr * 100 < -0.003) shortCnt++;
          else neutralCnt++;
        });
        return (
        <>

          {/* Market lean summary */}
          <div className="frh-summary-bar">
            <span className="frh-summary-heading">{t('FUNDING_MARKET_LEAN_HEADING')}</span>
            <span className="frh-summary-item" style={{ color: 'var(--red)' }}>
              <span className="frh-summary-count">{longCnt}</span> {t('FUNDING_LONG_HEAVY_LABEL')}
            </span>
            <span className="frh-summary-sep">·</span>
            <span className="frh-summary-item" style={{ color: 'var(--green-2)' }}>
              <span className="frh-summary-count">{shortCnt}</span> {t('FUNDING_SHORT_HEAVY_LABEL')}
            </span>
            <span className="frh-summary-sep">·</span>
            <span className="frh-summary-item" style={{ color: 'var(--txt3)' }}>
              <span className="frh-summary-count" style={{ color: 'var(--txt2)' }}>{neutralCnt}</span> {t('FUNDING_NEUTRAL_LABEL')}
            </span>
          </div>

          {/* Split: scrollable list left · sticky detail right */}
          <div className="frh-split">

            {/* ── LIST PANEL ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 0 }}>
              {/* Search bar */}
              <div style={{ borderBottom: '0.5px solid var(--bdr)', padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                  <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                  <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  placeholder={t('FUNDING_SEARCH_PLACEHOLDER')}
                  value={frSearch}
                  onChange={e => setFrSearch(e.target.value)}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '8px 0', fontSize: 'var(--fs-caption)', color: 'var(--txt)' }}
                />
                {frSearch && (
                  <button onClick={() => setFrSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--txt3)', fontSize: '0.8125rem', lineHeight: 1 }} aria-label={t('FUNDING_CLEAR_SEARCH_ARIA')}>×</button>
                )}
              </div>
              {/* Scrollable table */}
              <div className="frh-list-scroll">
                <table className="frh-table">
                  <thead>
                    <tr>
                      <th>{t('FUNDING_TABLE_COIN_COL')}</th>
                      <th>{t('FUNDING_TABLE_CURRENT_COL')}</th>
                      <th>{t('FUNDING_TABLE_AVG_COL', { range: t(RANGE_LABEL_KEYS[rangeKey]) })}</th>
                      <th>{t('FUNDING_TABLE_SIGNAL_COL')}</th>
                      <th className="frh-spark-th">{t('FUNDING_TABLE_LAST_COL', { range: t(RANGE_LABEL_KEYS[rangeKey]) })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COINS.filter(id => !frSearch || id.toLowerCase().includes(frSearch.toLowerCase())).map(id => {
                      const stats   = getStats(id);
                      const current = store.coins[id]?.fundingRate ?? null;
                      const pts     = (history[id] ?? []).slice(-rangeCount);
                      const noData  = pts.length < 2;
                      return (
                        <tr
                          key={id}
                          className={`frh-row${selected === id ? ' on' : ''}`}
                          onClick={() => { if (!noData) setSelected(id); }}
                          style={selected !== id && current != null ? { boxShadow: `inset 3px 0 0 ${withAlpha(frSignal(current).color, '44')}` } : undefined}
                        >
                          <td className="frh-coin" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CoinIcon coin={id} size={16} color={coinBadgeColor(id)} bg={withAlpha(coinBadgeColor(id), '24')} />
                            {COIN_LABELS[id]}
                          </td>
                          <td style={{ color: current != null ? frColor(current) : 'var(--txt3)', fontWeight: 700 }}>
                            {current != null ? frFmt(current) : '-'}
                          </td>
                          <td style={{ color: stats ? frColor(stats.avg) : 'var(--txt3)' }}>
                            {stats ? frFmt(stats.avg) : '-'}
                          </td>
                          <td>
                            {current != null
                              ? (() => {
                                  const sig = frSignal(current);
                                  return (
                                    <span className="frh-sig-chip" style={{ borderColor: withAlpha(sig.color, '44'), background: sig.bg }}>
                                      <span className="frh-sig-crowd" style={{ color: sig.color }}>{t(sig.crowdKey)}</span>
                                      <span className="frh-sig-hint">→ {t(sig.hintKey)}</span>
                                    </span>
                                  );
                                })()
                              : <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-caption)' }}>-</span>
                            }
                          </td>
                          <td className="frh-spark-cell">
                            {!noData
                              ? <canvas
                                  style={{ display: 'block', width: '100%', height: '36px' }}
                                  ref={el => { sparkRefs.current[id] = el ?? undefined; }}
                                />
                              : <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('FUNDING_NO_PERP_LABEL')}</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── DETAIL PANEL ── */}
            <div className="frh-detail-sticky">
              <div className="card frh-chart-card" style={{ marginBottom: 0 }}>
                <div className="frh-chart-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace" }}>{COIN_LABELS[selected]}</span>
                    <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-caption)' }}>· {rangeKey.toUpperCase()} {t('FUNDING_CHART_SUFFIX')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {currentCoin?.fundingRate != null && (
                      <span className="frh-current-badge" style={{ color: frColor(currentCoin.fundingRate) }}>
                        {frFmt(currentCoin.fundingRate)} {t('FUNDING_NOW_SUFFIX')}
                      </span>
                    )}
                    {(() => {
                      const s = getStats(selected);
                      return s?.extremes ? (
                        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Warn size={12} /> {t('FUNDING_EXTREME_COUNT', { count: s.extremes, plural: s.extremes > 1 ? 's' : '' })}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Signal banner */}
                {currentCoin?.fundingRate != null && (() => {
                  const sig = frSignal(currentCoin.fundingRate);
                  return (
                    <div className="frh-signal" style={{ background: sig.bg, borderColor: withAlpha(sig.color, '55') }}>
                      <div style={{ flex: 1 }}>
                        <div className="frh-signal-top">
                          <span className="frh-signal-label" style={{ color: sig.color }}>{t(sig.labelKey)}</span>
                          <span className="frh-signal-action" style={{ color: sig.color }}>→ {t(sig.actionKey)}</span>
                        </div>
                        <div className="frh-signal-desc">{t(sig.descKey)}</div>
                      </div>
                    </div>
                  );
                })()}

                {(history[selected] ?? []).length >= 2
                  ? <canvas ref={fullChartRef} style={{ display: 'block', width: '100%', height: '190px' }} />
                  : <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt3)', fontSize: 'var(--fs-caption)' }}>
                      {t('FUNDING_NO_PERP_DATA', { coin: COIN_LABELS[selected] })}
                    </div>
                }
                <div className="frh-legend">
                  <span style={{ color: 'var(--red)' }}>{t('FUNDING_LEGEND_POSITIVE_LABEL')}</span> = {t('FUNDING_LEGEND_POSITIVE_DESC')} &nbsp;·&nbsp;
                  <span style={{ color: 'var(--green-2)' }}>{t('FUNDING_LEGEND_NEGATIVE_LABEL')}</span> = {t('FUNDING_LEGEND_NEGATIVE_DESC')}
                </div>
              </div>
            </div>

          </div>

        </>
        );
      })()}

    </div>
  );
}
