'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMarket, CoinId, COINS, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';
import LiqFeed, { Bucket } from '@/components/LiqFeed';
import WhaleTradesFeed from '@/components/WhaleTradesFeed';
import GexTable from '@/components/GexTable';
import { Warn } from '@/components/icons';
import { withAlpha } from '@/lib/color';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { useDesignMode } from '@/components/DesignModeProvider';
import LiqTerminal from '@/components/LiqTerminal';
import type { LabelKey } from '@/lib/labelKeys';


/* ─── All leverage tiers - every real level Binance/Bybit offers ──────────── */
const TIERS = [
  { lev: 125, dist: 0.0080, w: 0.02 },
  { lev: 100, dist: 0.0100, w: 0.04 },
  { lev: 75,  dist: 0.0133, w: 0.03 },
  { lev: 50,  dist: 0.0200, w: 0.07 },
  { lev: 40,  dist: 0.0250, w: 0.04 },
  { lev: 30,  dist: 0.0333, w: 0.06 },
  { lev: 25,  dist: 0.0400, w: 0.08 },
  { lev: 20,  dist: 0.0500, w: 0.10 },
  { lev: 15,  dist: 0.0667, w: 0.08 },
  { lev: 12,  dist: 0.0833, w: 0.06 },
  { lev: 10,  dist: 0.1000, w: 0.10 },
  { lev: 8,   dist: 0.1250, w: 0.05 },
  { lev: 6,   dist: 0.1667, w: 0.04 },
  { lev: 5,   dist: 0.2000, w: 0.07 },
  { lev: 4,   dist: 0.2500, w: 0.05 },
  { lev: 3,   dist: 0.3333, w: 0.06 },
  { lev: 2,   dist: 0.5000, w: 0.05 },
];

type TimeRange = '12h' | '24h' | '48h' | '3d' | '1w';

// Coins covered by the liquidation delta feed (Binance futures forceOrder stream mapping)
const LIQ_DELTA_COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'near', 'sui'];

const RANGE_TO_PERIOD: Record<TimeRange, string> = {
  '12h': '1h',
  '24h': '4h',
  '48h': '6h',
  '3d':  '12h',
  '1w':  '1d',
};

// Bybit's account-ratio endpoint only accepts 5min/15min/30min/1h/4h/12h/1d -
// no 6h or 2h option (unlike Binance), so it needs its own mapping.
const RANGE_TO_BYBIT_PERIOD: Record<TimeRange, string> = {
  '12h': '1h',
  '24h': '4h',
  '48h': '4h',
  '3d':  '12h',
  '1w':  '1d',
};

const RANGES: { key: TimeRange; labelKey: LabelKey; maxDist: number; hintKey: LabelKey }[] = [
  { key: '12h', labelKey: 'LIQ_RANGE_LABEL_12H', maxDist: 0.05,  hintKey: 'LIQ_RANGE_HINT_12H' },
  { key: '24h', labelKey: 'LIQ_RANGE_LABEL_24H', maxDist: 0.10,  hintKey: 'LIQ_RANGE_HINT_24H' },
  { key: '48h', labelKey: 'LIQ_RANGE_LABEL_48H', maxDist: 0.13,  hintKey: 'LIQ_RANGE_HINT_48H' },
  { key: '3d',  labelKey: 'LIQ_RANGE_LABEL_3D',  maxDist: 0.25,  hintKey: 'LIQ_RANGE_HINT_3D' },
  { key: '1w',  labelKey: 'LIQ_RANGE_LABEL_1W',  maxDist: 0.50,  hintKey: 'LIQ_RANGE_HINT_1W' },
];

/* ─── Estimated band types ─────────────────────────────────────────────────── */
interface Band {
  price: number; distPct: number; usdM: number;
  lev: string; side: 'long' | 'short'; barPct: number; isMagnet: boolean;
}

/* ─── Estimated bands computation ─────────────────────────────────────────── */
function computeBands(price: number, oi: number, longR: number, shortR: number, maxDist: number) {
  const oiM = oi / 1e6;
  const active = TIERS.filter(t => t.dist <= maxDist);

  const longs: Band[] = active.map(t => ({
    price: price * (1 - t.dist), distPct: t.dist * 100,
    usdM: oiM * longR * t.w, lev: `${t.lev}x`,
    side: 'long' as const, barPct: 0, isMagnet: false,
  }));
  const shorts: Band[] = active.map(t => ({
    price: price * (1 + t.dist), distPct: t.dist * 100,
    usdM: oiM * shortR * t.w, lev: `${t.lev}x`,
    side: 'short' as const, barPct: 0, isMagnet: false,
  }));

  const maxUSD = Math.max(...longs.map(b => b.usdM), ...shorts.map(b => b.usdM), 1);
  [...longs, ...shorts].forEach(b => { b.barPct = (b.usdM / maxUSD) * 100; });

  const magL = longs.length  ? [...longs].sort((a, b)  => b.usdM - a.usdM)[0] : null;
  const magS = shorts.length ? [...shorts].sort((a, b) => b.usdM - a.usdM)[0] : null;
  if (magL) magL.isMagnet = true;
  if (magS) magS.isMagnet = true;

  return {
    longs, shortsDisplay: [...shorts].reverse(),
    magnetLong: magL, magnetShort: magS,
    totalLongM: longs.reduce((s, b) => s + b.usdM, 0),
    totalShortM: shorts.reduce((s, b) => s + b.usdM, 0),
    tierCount: active.length,
  };
}

/* ─── Formatters ───────────────────────────────────────────────────────────── */
function fmtP(price: number): string {
  if (price >= 10_000) return '$' + Math.round(price).toLocaleString('en-US');
  if (price >= 100)    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1)      return '$' + price.toFixed(3);
  return '$' + price.toFixed(4);
}
function fmtM(v: number): string {
  if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
  if (v >= 1)    return '$' + v.toFixed(1) + 'M';
  return '$' + (v * 1000).toFixed(0) + 'K';
}
function fmtUsd(v: number): string {
  if (v >= 1_000_000_000) return '$' + (v / 1_000_000_000).toFixed(1) + 'B';
  if (v >= 1_000_000)     return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)         return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

/* ─── Estimated band row ───────────────────────────────────────────────────── */
function BandRow({ b }: { b: Band }) {
  const isLong = b.side === 'long';
  const accent = isLong ? 'var(--red)' : 'var(--green-2)';
  return (
    <div className={`liq-row${b.isMagnet ? ' liq-row-magnet' : ''}`} role="row">
      <span className="liq-row-price">{fmtP(b.price)}</span>
      <span className="liq-row-dist" style={{ color: 'var(--txt3)' }}>
        {b.distPct < 1 ? b.distPct.toFixed(1) : Math.round(b.distPct)}%
      </span>
      <span className="liq-row-lev" style={{ color: accent }}>
        {b.lev}{b.isMagnet ? ' ◆' : ''}
      </span>
      <div className="liq-row-bar-wrap">
        <div className="liq-row-bar" style={{
          width: Math.max(b.barPct, 2) + '%',
          background: `linear-gradient(90deg, ${isLong ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.10)'}, ${isLong ? 'rgba(248,113,113,0.60)' : 'rgba(52,211,153,0.60)'})`,
          boxShadow: b.isMagnet ? `0 0 10px ${withAlpha(accent, '44')}` : 'none',
        }} />
      </div>
      <span className="liq-row-usd" style={{ color: accent }}>{fmtM(b.usdM)}</span>
    </div>
  );
}

/* ─── Real cluster card ─────────────────────────────────────────────────────── */
function RealClusters({ clusters, currentPrice }: { clusters: Bucket[]; currentPrice: number }) {
  const { t } = useLabels();
  if (clusters.length === 0) {
    return (
      <div style={{
        padding: '12px 14px', borderRadius: 10, marginBottom: 12,
        background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: '#fbbf24', boxShadow: '0 0 6px #fbbf2466',
        }} />
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('LIQ_CLUSTERS_BUILDING')}
        </span>
      </div>
    );
  }

  const maxTotal = Math.max(...clusters.map(c => c.total));
  const above = clusters.filter(c => c.price > currentPrice).sort((a, b) => a.price - b.price);
  const below = clusters.filter(c => c.price <= currentPrice).sort((a, b) => b.price - a.price);
  // Any buckets that straddle current price get shown separately
  const sorted = [...above, ...below];

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      border: '0.5px solid rgba(52,211,153,0.2)',
      background: 'rgba(52,211,153,0.03)',
      marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: '#34d399', boxShadow: '0 0 6px #34d39966',
          }} />
          <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)' }}>
            {t('LIQ_CLUSTERS_TITLE')}
          </span>
          <span style={{
            fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.06em',
            padding: '2px 7px', borderRadius: 10,
            background: 'rgba(52,211,153,0.12)', color: 'var(--green-2)',
            border: '0.5px solid rgba(52,211,153,0.25)',
          }}>{t('LIQ_CLUSTERS_LIVE_BADGE')}</span>
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('LIQ_CLUSTERS_WINDOW_LABEL')}</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '80px 1fr 60px 24px',
        padding: '6px 14px 4px',
        gap: 8,
      }}>
        {[[t('LIQ_CLUSTERS_COL_PRICE'), 'left'], [t('LIQ_CLUSTERS_COL_VOLUME'), 'left'], [t('LIQ_CLUSTERS_COL_TOTAL'), 'right'], ['', 'right']].map(([h, a]) => (
          <span key={h} style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: a as 'left' | 'right' }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ padding: '0 14px 10px' }}>
        {sorted.map(c => {
          const longPct  = maxTotal > 0 ? (c.longUsd  / maxTotal) * 100 : 0;
          const shortPct = maxTotal > 0 ? (c.shortUsd / maxTotal) * 100 : 0;
          const isAbove  = c.price > currentPrice;
          const domCol   = c.longUsd > c.shortUsd ? 'var(--red)' : 'var(--green-2)';
          const distUsd  = currentPrice > 0 ? Math.abs(c.price - currentPrice) : 0;
          return (
            <div key={c.price} style={{
              display: 'grid', gridTemplateColumns: '80px 1fr 60px 24px',
              alignItems: 'center', gap: 8,
              padding: '5px 0',
              borderBottom: '0.5px solid rgba(255,255,255,0.04)',
            }}>
              <div>
                <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.label}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
                  {fmtP(distUsd)} {isAbove ? t('LIQ_CLUSTERS_ABOVE') : t('LIQ_CLUSTERS_BELOW')}
                </div>
              </div>
              {/* Stacked bars */}
              <div style={{ height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${longPct}%`,  height: '100%', background: 'rgba(248,113,113,0.65)', transition: 'width 0.4s' }} />
                <div style={{ width: `${shortPct}%`, height: '100%', background: 'rgba(52,211,153,0.65)',  transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: domCol, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsd(c.total)}
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: domCol, textAlign: 'right' }}>
                {c.longUsd > c.shortUsd ? t('LIQ_CLUSTERS_DOM_LONG') : t('LIQ_CLUSTERS_DOM_SHORT')}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '6px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)', fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
        {t('LIQ_CLUSTERS_FOOTER_LEGEND')}
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function LiqPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
  const { store }  = useMarket();
  const [coin, setCoin]   = useState<CoinId>('btc');
  const [range, setRange] = useState<TimeRange>('24h');
  const [realClusters, setRealClusters] = useState<Bucket[]>([]);
  const handleClusters = useCallback((c: Bucket[]) => setRealClusters(c), []);
  const [whalePos, setWhalePos] = useState<{ longRatio: number; shortRatio: number } | null>(null);
  const [retailPos, setRetailPos] = useState<{ longRatio: number; shortRatio: number } | null>(null);
  const [bybitPos, setBybitPos] = useState<{ longRatio: number; shortRatio: number } | null>(null);

  /* Refetch whale positioning whenever coin or timeframe changes */
  useEffect(() => {
    const sym = BINANCE_SYMS[coin];
    if (!sym) { setWhalePos(null); return; }   // Bybit-only coin (HYPE etc.)
    const period = RANGE_TO_PERIOD[range];
    let cancelled = false;
    fetch(`/api/proxy?type=lsr-top&symbol=${sym}&period=${period}&limit=1`)
      .then(r => r.json())
      .then((data: Array<{ longAccount: string; shortAccount: string }>) => {
        if (cancelled || !Array.isArray(data) || !data[0]) return;
        setWhalePos({ longRatio: parseFloat(data[0].longAccount), shortRatio: parseFloat(data[0].shortAccount) });
      })
      .catch(() => { if (!cancelled) setWhalePos(null); });
    return () => { cancelled = true; };
  }, [coin, range]);

  /* Refetch retail (all-account) long/short ratio whenever coin or timeframe changes -
     the "Long/Short accounts" stat row previously always showed the global store's
     fixed-period snapshot (Bybit 1h / Binance 5m) regardless of the Time Range selector. */
  useEffect(() => {
    const sym = BINANCE_SYMS[coin];
    if (!sym) { setRetailPos(null); return; }   // Bybit-only coin (HYPE etc.)
    const period = RANGE_TO_PERIOD[range];
    let cancelled = false;
    fetch(`/api/proxy?type=lsr-global&symbol=${sym}&period=${period}&limit=1`)
      .then(r => r.json())
      .then((data: Array<{ longAccount: string; shortAccount: string }>) => {
        if (cancelled || !Array.isArray(data) || !data[0]) return;
        setRetailPos({ longRatio: parseFloat(data[0].longAccount), shortRatio: parseFloat(data[0].shortAccount) });
      })
      .catch(() => { if (!cancelled) setRetailPos(null); });
    return () => { cancelled = true; };
  }, [coin, range]);

  /* Refetch Bybit account ratio whenever coin or timeframe changes - same fix as the
     Binance retail ratio above, using Bybit's own supported period values (no 6h/2h). */
  useEffect(() => {
    const sym = BYBIT_SYMS[coin];
    if (!sym) { setBybitPos(null); return; }
    const period = RANGE_TO_BYBIT_PERIOD[range];
    let cancelled = false;
    fetch(`/api/proxy?type=account-ratio-1&symbol=${sym}&period=${period}&limit=1`)
      .then(r => r.json())
      .then((d: { result?: { list?: Array<{ buyRatio: string; sellRatio: string }> } }) => {
        if (cancelled) return;
        const item = d.result?.list?.[0];
        if (!item) return;
        setBybitPos({ longRatio: parseFloat(item.buyRatio), shortRatio: parseFloat(item.sellRatio) });
      })
      .catch(() => { if (!cancelled) setBybitPos(null); });
    return () => { cancelled = true; };
  }, [coin, range]);

  const cd         = store.coins[coin];
  const rangeConf  = RANGES.find(r => r.key === range)!;

  /* Estimated bands */
  const bands = useMemo(() => {
    if (!cd?.price || !cd?.oi) return null;
    return computeBands(cd.price, cd.oi, cd.longRatio ?? 0.5, cd.shortRatio ?? 0.5, rangeConf.maxDist);
  }, [cd?.price, cd?.oi, cd?.longRatio, cd?.shortRatio, rangeConf.maxDist]);

  /* Bias */
  const bias = bands
    ? bands.totalLongM > bands.totalShortM * 1.15
      ? { txt: t('LIQ_BIAS_LONG_HEAVY'), sub: t('LIQ_BIAS_LONG_HEAVY_SUB'), col: 'var(--red)' }
      : bands.totalShortM > bands.totalLongM * 1.15
      ? { txt: t('LIQ_BIAS_SHORT_HEAVY'), sub: t('LIQ_BIAS_SHORT_HEAVY_SUB'), col: 'var(--green-2)' }
      : { txt: t('LIQ_BIAS_BALANCED'), sub: t('LIQ_BIAS_BALANCED_SUB'), col: 'var(--txt-dim)' }
    : null;

  if (mode === 'terminal') return <LiqTerminal />;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
          {t('LIQ_TITLE')}
        </h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('LIQ_SUBTITLE')}
        </div>
      </div>

      {/* Coin selector dropdown */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <select
            value={coin}
            onChange={e => setCoin(e.target.value as CoinId)}
            style={{
              background: 'var(--bg2)',
              border: '0.5px solid rgba(60,72,200,0.45)',
              color: 'var(--txt)',
              fontSize: 'var(--fs-label)',
              fontWeight: 700,
              padding: '7px 30px 7px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              outline: 'none',
              colorScheme: 'dark',
              letterSpacing: '.05em',
              minWidth: 150,
            }}
          >
            {COINS.map(c => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <span style={{
            position: 'absolute', right: 9, top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none', color: 'var(--txt3)', fontSize: '0.625rem',
          }}>▼</span>
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('LIQ_COIN_COUNT', { count: COINS.length })}
        </span>
      </div>

      {/* Time range */}
      <div className="liq-range-row">
        {RANGES.map(r => (
          <button key={r.key} className={`liq-range-btn${range === r.key ? ' on' : ''}`} onClick={() => setRange(r.key)}>
            {t(r.labelKey)}
          </button>
        ))}
      </div>
      <div className="liq-range-hint">
        {t(rangeConf.hintKey)}
        {cd?.price && (
          <span style={{ color: 'var(--txt-dim)', marginLeft: 8 }}>
            · {fmtP(cd.price * (1 - rangeConf.maxDist))} – {fmtP(cd.price * (1 + rangeConf.maxDist))}
          </span>
        )}
      </div>

      {!cd?.price && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }} role="status" aria-live="polite">
          <span className="sr-only">{t('LIQ_LOADING_SR', { coin: coin.toUpperCase() })}</span>
          <SkeletonBar width={140} height={14} radius={4} style={{ margin: '0 auto' }} />
        </div>
      )}
      {cd?.price && !cd?.oi && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--txt-dim)', padding: '2rem' }}>
          {t('LIQ_NO_OI_DATA', { coin: coin.toUpperCase() })}
        </div>
      )}

      {bands && cd?.price && cd?.oi && (
        <>
          {/* Bias - most actionable signal, show first */}
          {bias && (
            <div className="liq-bias-card" style={{ borderColor: withAlpha(bias.col, '33') }}>
              <span className="liq-bias-badge" style={{ color: bias.col, background: withAlpha(bias.col, '16') }}>{bias.txt}</span>
              <span className="liq-bias-sub">{bias.sub}</span>
            </div>
          )}


          {/* Real liquidation clusters from live feeds - filtered to selected coin */}
          <RealClusters clusters={realClusters.filter(c => c.coin.toLowerCase() === coin).slice(0, 8)} currentPrice={cd.price} />

          {/* Stats row */}
          <div className="liq-stats-row">
            {/* Long side - both exchanges */}
            <div className="liq-stat-item">
              <div className="liq-stat-label">{t('LIQ_STAT_LONG_ACCOUNTS')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
                    {((bybitPos?.longRatio ?? cd.longRatio ?? 0.5) * 100).toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('LIQ_STAT_BYBIT_PERIOD', { period: bybitPos ? RANGE_TO_BYBIT_PERIOD[range] : '1h' })}</span>
                </div>
                {(retailPos?.longRatio ?? cd.bnLongRatio) != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'rgba(248,113,113,0.65)', fontVariantNumeric: 'tabular-nums' }}>
                      {((retailPos?.longRatio ?? cd.bnLongRatio!) * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('LIQ_STAT_BINANCE_PERIOD', { period: retailPos ? RANGE_TO_PERIOD[range] : '5m' })}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="liq-stat-sep" />

            {/* Open Interest - center */}
            <div className="liq-stat-item" style={{ textAlign: 'center' }}>
              <div className="liq-stat-label" style={{ textAlign: 'center' }}>{t('LIQ_STAT_OPEN_INTEREST')}</div>
              <div className="liq-stat-val" style={{ color: 'var(--accent)', textAlign: 'center' }}>
                {fmtM(cd.oi / 1e6)}
              </div>
              <div className="liq-stat-sub" style={{ textAlign: 'center' }}>{t('LIQ_STAT_ZONES_IN_WINDOW', { count: bands.tierCount })}</div>
            </div>

            <div className="liq-stat-sep" />

            {/* Short side - both exchanges */}
            <div className="liq-stat-item" style={{ textAlign: 'right' }}>
              <div className="liq-stat-label">{t('LIQ_STAT_SHORT_ACCOUNTS')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('LIQ_STAT_BYBIT_PERIOD', { period: bybitPos ? RANGE_TO_BYBIT_PERIOD[range] : '1h' })}</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--green-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {((bybitPos?.shortRatio ?? cd.shortRatio ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                {(retailPos?.shortRatio ?? cd.bnShortRatio) != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('LIQ_STAT_BINANCE_PERIOD', { period: retailPos ? RANGE_TO_PERIOD[range] : '5m' })}</span>
                    <span style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'rgba(52,211,153,0.65)', fontVariantNumeric: 'tabular-nums' }}>
                      {((retailPos?.shortRatio ?? cd.bnShortRatio!) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ LIQUIDATION DELTA - net long vs short liquidation $ (15min window) ══ */}
          {cd.liqDelta != null && cd.liqLongUsd != null && cd.liqShortUsd != null ? (() => {
            const netCol = cd.liqDelta! > 0 ? 'var(--red)' : cd.liqDelta! < 0 ? 'var(--green-2)' : 'var(--txt3)';
            const netTxt = cd.liqDelta! > 0
              ? t('LIQ_DELTA_NET_LONGS')
              : cd.liqDelta! < 0
              ? t('LIQ_DELTA_NET_SHORTS')
              : t('LIQ_DELTA_BALANCED');
            return (
              <div className="liq-bias-card" style={{ borderColor: withAlpha(netCol, '33'), marginTop: 10 }}>
                <span className="liq-bias-badge" style={{ color: netCol, background: withAlpha(netCol, '16') }}>
                  {cd.liqDelta! >= 0 ? '+' : '−'}{fmtM(Math.abs(cd.liqDelta!) / 1e6)}
                </span>
                <span className="liq-bias-sub">
                  {t('LIQ_DELTA_SUMMARY', { netText: netTxt, longUsd: fmtM(cd.liqLongUsd / 1e6), shortUsd: fmtM(cd.liqShortUsd / 1e6) })}
                </span>
              </div>
            );
          })() : (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 2px 0' }}>
              {LIQ_DELTA_COINS.includes(coin)
                ? t('LIQ_DELTA_WARMING_UP')
                : t('LIQ_DELTA_UNAVAILABLE', { coin: coin.toUpperCase(), coins: LIQ_DELTA_COINS.map(c => c.toUpperCase()).join(', ') })}
            </div>
          )}

          {/* ══ WHALE POSITIONING ════════════════════════════════ */}
          {(whalePos != null || (cd.bnWhaleLongRatio != null && cd.bnWhaleShortRatio != null)) && (() => {
            const whaleLong  = whalePos?.longRatio  ?? cd.bnWhaleLongRatio!;
            const whaleShort = whalePos?.shortRatio ?? cd.bnWhaleShortRatio!;
            const retailLong = cd.bnLongRatio ?? 0.5;

            // Divergence: retail leaning one way, whales leaning opposite
            const longSqueezeRisk  = retailLong  > 0.55 && whaleShort > 0.52;
            const shortSqueezeRisk = retailLong  < 0.45 && whaleLong  > 0.52;
            const hasDivergence    = longSqueezeRisk || shortSqueezeRisk;

            const whaleSide = whaleLong > whaleShort ? 'long' : 'short';
            const accentW   = whaleSide === 'long' ? 'var(--red)' : 'var(--green-2)';

            return (
              <div style={{
                borderRadius: 12, overflow: 'hidden', marginBottom: 10,
                background: hasDivergence ? 'rgba(245,158,11,0.04)' : 'var(--bg1)',
                border: `0.5px solid ${hasDivergence ? 'rgba(245,158,11,0.25)' : 'var(--bdr)'}`,
              }}>
                {/* Header */}
                <div style={{
                  padding: '10px 16px 8px',
                  borderBottom: '0.5px solid var(--bdr)',
                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)' }}>
                      {t('LIQ_WHALE_TITLE')}
                    </span>
                    <span style={{
                      fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em',
                      padding: '2px 7px', borderRadius: 10,
                      background: withAlpha(accentW, '14'), color: accentW,
                      border: `0.5px solid ${withAlpha(accentW, '30')}`,
                      textTransform: 'uppercase',
                    }}>
                      {whaleSide === 'long' ? t('LIQ_WHALE_BADGE_LONG') : t('LIQ_WHALE_BADGE_SHORT')}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {t('LIQ_WHALE_SOURCE_LABEL', { period: whalePos != null ? RANGE_TO_PERIOD[range] : '5m' })}
                  </span>
                </div>

                {/* Bar + numbers */}
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ flex: whaleLong,  background: '#f87171', opacity: 0.7 }} />
                    <div style={{ flex: whaleShort, background: '#34d399', opacity: 0.7 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
                        {(whaleLong * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginLeft: 5 }}>{t('LIQ_WHALE_LONG_SUFFIX')}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginRight: 5 }}>{t('LIQ_WHALE_SHORT_SUFFIX')}</span>
                      <span style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--green-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {(whaleShort * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Divergence alert */}
                {hasDivergence && (
                  <div style={{
                    margin: '0 16px 12px',
                    padding: '10px 12px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.07)',
                    border: '0.5px solid rgba(245,158,11,0.3)',
                    display: 'flex', gap: 8, alignItems: 'flex-start',
                  }}>
                    <span style={{ color: '#f59e0b', flexShrink: 0, lineHeight: 0 }}><Warn size={13} /></span>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.6 }}>
                      {longSqueezeRisk ? (
                        <>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{t('LIQ_WHALE_LONG_SQUEEZE_TITLE')}</span>
                          {' '}{t('LIQ_WHALE_LONG_SQUEEZE_BODY', { retailPct: (retailLong * 100).toFixed(0), whalePct: (whaleShort * 100).toFixed(0) })}
                        </>
                      ) : (
                        <>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{t('LIQ_WHALE_SHORT_SQUEEZE_TITLE')}</span>
                          {' '}{t('LIQ_WHALE_SHORT_SQUEEZE_BODY', { retailPct: ((1 - retailLong) * 100).toFixed(0), whalePct: (whaleLong * 100).toFixed(0) })}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ══ ESTIMATED HEATMAP ══════════════════════════════════ */}
          <div className="liq-card">
            <div className="liq-section-hdr liq-section-hdr-short" role="heading" aria-level={3}>
              <span>{t('LIQ_HEATMAP_SHORT_HEADER')}</span>
              <span className="liq-section-sub">{t('LIQ_HEATMAP_SHORT_SUB', { range: t(rangeConf.labelKey) })}</span>
            </div>
            <div role="table" aria-label={t('LIQ_HEATMAP_SHORT_ARIA')}>
              <div className="liq-col-hdr" role="row">
                <span role="columnheader">{t('LIQ_HEATMAP_COL_PRICE')}</span>
                <span role="columnheader">{t('LIQ_HEATMAP_COL_PCT_AWAY')}</span>
                <span role="columnheader"><abbr title={t('LIQ_HEATMAP_COL_LEV_TITLE')}>{t('LIQ_HEATMAP_COL_LEV_ABBR')}</abbr></span>
                <span role="columnheader">{t('LIQ_HEATMAP_COL_DENSITY')}</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>{t('LIQ_HEATMAP_COL_EST_USD')}</span>
              </div>
              {bands.shortsDisplay.map((b, i) => <BandRow key={`s${i}`} b={b} />)}
            </div>

            <div className="liq-current-bar">
              <span className="liq-current-dot" />
              <span className="liq-current-price">{fmtP(cd.price)}</span>
              <span className="liq-current-chg" style={{ color: (cd.change ?? 0) >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
                {(cd.change ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(cd.change ?? 0).toFixed(2)}%
              </span>
              <span className="liq-current-tag">{t('LIQ_HEATMAP_LIVE_TAG')}</span>
              <span className="liq-current-oi">{t('LIQ_HEATMAP_OI_LABEL', { amount: fmtM(cd.oi / 1e6) })}</span>
            </div>

            <div className="liq-section-hdr liq-section-hdr-long" role="heading" aria-level={3}>
              <span>{t('LIQ_HEATMAP_LONG_HEADER')}</span>
              <span className="liq-section-sub">{t('LIQ_HEATMAP_LONG_SUB', { range: t(rangeConf.labelKey) })}</span>
            </div>
            <div role="table" aria-label={t('LIQ_HEATMAP_LONG_ARIA')}>
              {bands.longs.map((b, i) => <BandRow key={`l${i}`} b={b} />)}
            </div>
          </div>

          {/* Legend */}
          <div className="liq-howto">
            <div className="liq-howto-title">{t('LIQ_LEGEND_TITLE')}</div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#34d399' }} />
              <span><strong style={{ color: 'var(--green-2)' }}>{t('LIQ_LEGEND_SHORT_BOLD')}</strong> - {t('LIQ_LEGEND_SHORT_TEXT')}</span>
            </div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#f87171' }} />
              <span><strong style={{ color: 'var(--red)' }}>{t('LIQ_LEGEND_LONG_BOLD')}</strong> - {t('LIQ_LEGEND_LONG_TEXT')}</span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>◆</span>
              <span><strong>{t('LIQ_LEGEND_MAGNET_BOLD')}</strong> - {t('LIQ_LEGEND_MAGNET_TEXT')}</span>
            </div>
          </div>

          <div className="liq-disclaimer">
            {t('LIQ_DISCLAIMER')}
          </div>
        </>
      )}

      {/* Live Liquidation Feed */}
      <LiqFeed onClusters={handleClusters} coinFilter={coin.toUpperCase()} />

      {/* Whale Trade Feed */}
      <WhaleTradesFeed />

      {/* Options GEX levels */}
      <GexTable />

    </div>
  );
}
