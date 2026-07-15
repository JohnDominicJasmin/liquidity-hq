'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMarket, CoinId, COINS, BINANCE_SYMS, BYBIT_SYMS } from '@/lib/marketStore';
import LiqFeed, { Bucket } from '@/components/LiqFeed';
import WhaleTradesFeed from '@/components/WhaleTradesFeed';
import GexTable from '@/components/GexTable';


/* ─── All leverage tiers — every real level Binance/Bybit offers ──────────── */
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

// Bybit's account-ratio endpoint only accepts 5min/15min/30min/1h/4h/12h/1d —
// no 6h or 2h option (unlike Binance), so it needs its own mapping.
const RANGE_TO_BYBIT_PERIOD: Record<TimeRange, string> = {
  '12h': '1h',
  '24h': '4h',
  '48h': '4h',
  '3d':  '12h',
  '1w':  '1d',
};

const RANGES: { key: TimeRange; label: string; maxDist: number; hint: string }[] = [
  { key: '12h', label: '12h',    maxDist: 0.05,  hint: 'Short-term moves · showing clusters within ±5% of current price' },
  { key: '24h', label: '24h',    maxDist: 0.10,  hint: 'Day trade range · showing clusters within ±10% of current price' },
  { key: '48h', label: '48h',    maxDist: 0.13,  hint: '2-day swing range · showing clusters within ±13% of current price' },
  { key: '3d',  label: '3 days', maxDist: 0.25,  hint: 'Multi-day swing range · showing clusters within ±25% of current price' },
  { key: '1w',  label: '1 week', maxDist: 0.50,  hint: 'Full week range · showing all clusters within ±50% of current price' },
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
  const accent = isLong ? '#f87171' : '#34d399';
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
          boxShadow: b.isMagnet ? `0 0 10px ${accent}44` : 'none',
        }} />
      </div>
      <span className="liq-row-usd" style={{ color: accent }}>{fmtM(b.usdM)}</span>
    </div>
  );
}

/* ─── Real cluster card ─────────────────────────────────────────────────────── */
function RealClusters({ clusters, currentPrice }: { clusters: Bucket[]; currentPrice: number }) {
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
        <span style={{ fontSize: 12, color: 'var(--txt3)' }}>
          Real cluster data building from live Binance + Bybit feeds — takes a few minutes on first load.
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
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>
            Real Liquidation Clusters
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
            padding: '2px 7px', borderRadius: 10,
            background: 'rgba(52,211,153,0.12)', color: '#34d399',
            border: '0.5px solid rgba(52,211,153,0.25)',
          }}>LIVE DATA</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>24h window · Binance + Bybit</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '80px 1fr 60px 24px',
        padding: '6px 14px 4px',
        gap: 8,
      }}>
        {[['Price', 'left'], ['Volume (longs red · shorts green)', 'left'], ['Total', 'right'], ['', 'right']].map(([h, a]) => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', textAlign: a as 'left' | 'right' }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ padding: '0 14px 10px' }}>
        {sorted.map(c => {
          const longPct  = maxTotal > 0 ? (c.longUsd  / maxTotal) * 100 : 0;
          const shortPct = maxTotal > 0 ? (c.shortUsd / maxTotal) * 100 : 0;
          const isAbove  = c.price > currentPrice;
          const domCol   = c.longUsd > c.shortUsd ? '#f87171' : '#34d399';
          const distUsd  = currentPrice > 0 ? Math.abs(c.price - currentPrice) : 0;
          return (
            <div key={c.price} style={{
              display: 'grid', gridTemplateColumns: '80px 1fr 60px 24px',
              alignItems: 'center', gap: 8,
              padding: '5px 0',
              borderBottom: '0.5px solid rgba(255,255,255,0.04)',
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.label}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)' }}>
                  {fmtP(distUsd)} {isAbove ? '↑ above' : '↓ below'}
                </div>
              </div>
              {/* Stacked bars */}
              <div style={{ height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${longPct}%`,  height: '100%', background: 'rgba(248,113,113,0.65)', transition: 'width 0.4s' }} />
                <div style={{ width: `${shortPct}%`, height: '100%', background: 'rgba(52,211,153,0.65)',  transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: domCol, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmtUsd(c.total)}
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: domCol, textAlign: 'right' }}>
                {c.longUsd > c.shortUsd ? 'L' : 'S'}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '6px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)', fontSize: 10, color: '#444' }}>
        Red bars = long liquidations at that price · Green bars = short liquidations · L/S = dominant side
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function LiqPage() {
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
    fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${period}&limit=1`)
      .then(r => r.json())
      .then((data: Array<{ longAccount: string; shortAccount: string }>) => {
        if (cancelled || !Array.isArray(data) || !data[0]) return;
        setWhalePos({ longRatio: parseFloat(data[0].longAccount), shortRatio: parseFloat(data[0].shortAccount) });
      })
      .catch(() => { if (!cancelled) setWhalePos(null); });
    return () => { cancelled = true; };
  }, [coin, range]);

  /* Refetch retail (all-account) long/short ratio whenever coin or timeframe changes —
     the "Long/Short accounts" stat row previously always showed the global store's
     fixed-period snapshot (Bybit 1h / Binance 5m) regardless of the Time Range selector. */
  useEffect(() => {
    const sym = BINANCE_SYMS[coin];
    if (!sym) { setRetailPos(null); return; }   // Bybit-only coin (HYPE etc.)
    const period = RANGE_TO_PERIOD[range];
    let cancelled = false;
    fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${period}&limit=1`)
      .then(r => r.json())
      .then((data: Array<{ longAccount: string; shortAccount: string }>) => {
        if (cancelled || !Array.isArray(data) || !data[0]) return;
        setRetailPos({ longRatio: parseFloat(data[0].longAccount), shortRatio: parseFloat(data[0].shortAccount) });
      })
      .catch(() => { if (!cancelled) setRetailPos(null); });
    return () => { cancelled = true; };
  }, [coin, range]);

  /* Refetch Bybit account ratio whenever coin or timeframe changes — same fix as the
     Binance retail ratio above, using Bybit's own supported period values (no 6h/2h). */
  useEffect(() => {
    const sym = BYBIT_SYMS[coin];
    if (!sym) { setBybitPos(null); return; }
    const period = RANGE_TO_BYBIT_PERIOD[range];
    let cancelled = false;
    fetch(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=${period}&limit=1`)
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
      ? { txt: 'Long-heavy', sub: 'More trapped longs below - larger traders may push price down to trigger them', col: '#f87171' }
      : bands.totalShortM > bands.totalLongM * 1.15
      ? { txt: 'Short-heavy', sub: 'More trapped shorts above - larger traders may push price up to trigger them', col: '#34d399' }
      : { txt: 'Balanced', sub: 'Roughly equal liquidation pressure on both sides - no strong directional lean', col: '#606060' }
    : null;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
          Liquidation Heatmap
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
          Estimated liquidation zones · nearest dense cluster = price magnet
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
              fontSize: 13,
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
            pointerEvents: 'none', color: 'var(--txt3)', fontSize: 10,
          }}>▼</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
          {COINS.length} coins
        </span>
      </div>

      {/* Time range */}
      <div className="liq-range-row">
        {RANGES.map(r => (
          <button key={r.key} className={`liq-range-btn${range === r.key ? ' on' : ''}`} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="liq-range-hint">
        {rangeConf.hint}
        {cd?.price && (
          <span style={{ color: '#555', marginLeft: 8 }}>
            · {fmtP(cd.price * (1 - rangeConf.maxDist))} – {fmtP(cd.price * (1 + rangeConf.maxDist))}
          </span>
        )}
      </div>

      {!cd?.price && (
        <div className="card" style={{ textAlign: 'center', color: '#444', padding: '2rem' }}>
          Loading {coin.toUpperCase()}…
        </div>
      )}
      {cd?.price && !cd?.oi && (
        <div className="card" style={{ textAlign: 'center', color: '#444', padding: '2rem' }}>
          No open interest data for {coin.toUpperCase()}
        </div>
      )}

      {bands && cd?.price && cd?.oi && (
        <>
          {/* Bias — most actionable signal, show first */}
          {bias && (
            <div className="liq-bias-card" style={{ borderColor: `${bias.col}33` }}>
              <span className="liq-bias-badge" style={{ color: bias.col, background: `${bias.col}16` }}>{bias.txt}</span>
              <span className="liq-bias-sub">{bias.sub}</span>
            </div>
          )}


          {/* Real liquidation clusters from live feeds — filtered to selected coin */}
          <RealClusters clusters={realClusters.filter(c => c.coin.toLowerCase() === coin).slice(0, 8)} currentPrice={cd.price} />

          {/* Stats row */}
          <div className="liq-stats-row">
            {/* Long side — both exchanges */}
            <div className="liq-stat-item">
              <div className="liq-stat-label">Long accounts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                    {((bybitPos?.longRatio ?? cd.longRatio ?? 0.5) * 100).toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Bybit · {bybitPos ? RANGE_TO_BYBIT_PERIOD[range] : '1h'}</span>
                </div>
                {(retailPos?.longRatio ?? cd.bnLongRatio) != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(248,113,113,0.65)', fontVariantNumeric: 'tabular-nums' }}>
                      {((retailPos?.longRatio ?? cd.bnLongRatio!) * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Binance · {retailPos ? RANGE_TO_PERIOD[range] : '5m'}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="liq-stat-sep" />

            {/* Open Interest — center */}
            <div className="liq-stat-item" style={{ textAlign: 'center' }}>
              <div className="liq-stat-label" style={{ textAlign: 'center' }}>Open Interest</div>
              <div className="liq-stat-val" style={{ color: 'var(--accent)', textAlign: 'center' }}>
                {fmtM(cd.oi / 1e6)}
              </div>
              <div className="liq-stat-sub" style={{ textAlign: 'center' }}>{bands.tierCount}/17 zones in window</div>
            </div>

            <div className="liq-stat-sep" />

            {/* Short side — both exchanges */}
            <div className="liq-stat-item" style={{ textAlign: 'right' }}>
              <div className="liq-stat-label">Short accounts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Bybit · {bybitPos ? RANGE_TO_BYBIT_PERIOD[range] : '1h'}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                    {((bybitPos?.shortRatio ?? cd.shortRatio ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                {(retailPos?.shortRatio ?? cd.bnShortRatio) != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--txt3)' }}>Binance · {retailPos ? RANGE_TO_PERIOD[range] : '5m'}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(52,211,153,0.65)', fontVariantNumeric: 'tabular-nums' }}>
                      {((retailPos?.shortRatio ?? cd.bnShortRatio!) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ LIQUIDATION DELTA — net long vs short liquidation $ (15min window) ══ */}
          {cd.liqDelta != null && cd.liqLongUsd != null && cd.liqShortUsd != null ? (() => {
            const netCol = cd.liqDelta! > 0 ? '#f87171' : cd.liqDelta! < 0 ? '#34d399' : 'var(--txt3)';
            const netTxt = cd.liqDelta! > 0
              ? 'Net longs liquidated'
              : cd.liqDelta! < 0
              ? 'Net shorts liquidated'
              : 'Balanced';
            return (
              <div className="liq-bias-card" style={{ borderColor: `${netCol}33`, marginTop: 10 }}>
                <span className="liq-bias-badge" style={{ color: netCol, background: `${netCol}16` }}>
                  {cd.liqDelta! >= 0 ? '+' : '−'}{fmtM(Math.abs(cd.liqDelta!) / 1e6)}
                </span>
                <span className="liq-bias-sub">
                  {netTxt} in the last 15m — Longs {fmtM(cd.liqLongUsd / 1e6)} · Shorts {fmtM(cd.liqShortUsd / 1e6)}
                </span>
              </div>
            );
          })() : (
            <div style={{ fontSize: 11, color: 'var(--txt3)', padding: '4px 2px 0' }}>
              {LIQ_DELTA_COINS.includes(coin)
                ? 'Warming up — waiting for enough liquidation volume in the last 15m.'
                : `Liquidation delta unavailable for ${coin.toUpperCase()} — tracked for ${LIQ_DELTA_COINS.map(c => c.toUpperCase()).join(', ')} only.`}
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
            const accentW   = whaleSide === 'long' ? '#f87171' : '#34d399';

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
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>
                      Whale Positioning
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
                      padding: '2px 7px', borderRadius: 10,
                      background: `${accentW}14`, color: accentW,
                      border: `0.5px solid ${accentW}30`,
                      textTransform: 'uppercase',
                    }}>
                      {whaleSide === 'long' ? 'Whale Long' : 'Whale Short'}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    Binance top traders · position-weighted · {whalePos != null ? RANGE_TO_PERIOD[range] : '5m'}
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
                      <span style={{ fontSize: 18, fontWeight: 800, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                        {(whaleLong * 100).toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 5 }}>whale long</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, color: 'var(--txt3)', marginRight: 5 }}>whale short</span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
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
                    <span style={{ color: '#f59e0b', fontSize: 13, flexShrink: 0 }}>⚠</span>
                    <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>
                      {longSqueezeRisk ? (
                        <>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>Long squeeze setup.</span>
                          {' '}Retail is {(retailLong * 100).toFixed(0)}% long but whales are positioned {(whaleShort * 100).toFixed(0)}% short.
                          Whales have the money to push price down and force-close retail longs.
                        </>
                      ) : (
                        <>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>Short squeeze setup.</span>
                          {' '}Retail is {((1 - retailLong) * 100).toFixed(0)}% short but whales are positioned {(whaleLong * 100).toFixed(0)}% long.
                          Whales have the money to push price up and force-close retail shorts.
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
              <span>↑ Short squeeze zones</span>
              <span className="liq-section-sub">price pumps, shorts get force-closed · {rangeConf.label}</span>
            </div>
            <div role="table" aria-label="Short squeeze liquidation zones">
              <div className="liq-col-hdr" role="row">
                <span role="columnheader">Price</span>
                <span role="columnheader">% Away</span>
                <span role="columnheader"><abbr title="Leverage">Lev.</abbr></span>
                <span role="columnheader">Relative density (model)</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>Est. USD</span>
              </div>
              {bands.shortsDisplay.map((b, i) => <BandRow key={`s${i}`} b={b} />)}
            </div>

            <div className="liq-current-bar">
              <span className="liq-current-dot" />
              <span className="liq-current-price">{fmtP(cd.price)}</span>
              <span className="liq-current-chg" style={{ color: (cd.change ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                {(cd.change ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(cd.change ?? 0).toFixed(2)}%
              </span>
              <span className="liq-current-tag">LIVE</span>
              <span className="liq-current-oi">{fmtM(cd.oi / 1e6)} Open Interest</span>
            </div>

            <div className="liq-section-hdr liq-section-hdr-long" role="heading" aria-level={3}>
              <span>↓ Long liquidation zones</span>
              <span className="liq-section-sub">price drops, longs get force-closed · {rangeConf.label}</span>
            </div>
            <div role="table" aria-label="Long liquidation zones">
              {bands.longs.map((b, i) => <BandRow key={`l${i}`} b={b} />)}
            </div>
          </div>

          {/* Legend */}
          <div className="liq-howto">
            <div className="liq-howto-title">How to read this</div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#34d399' }} />
              <span><strong style={{ color: '#34d399' }}>Short Squeeze Zones</strong> - price levels above current price where modeled short positions get force-closed. Larger traders push price UP into these to trigger them.</span>
            </div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#f87171' }} />
              <span><strong style={{ color: '#f87171' }}>Long Liquidation Zones</strong> - price levels below current price where modeled long positions get force-closed. Larger traders dump price DOWN into these.</span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>◆</span>
              <span><strong>Magnet</strong> - the largest estimated cluster in the selected window. The most likely price target for the next big move.</span>
            </div>
          </div>

          <div className="liq-disclaimer">
            Model only — price levels are mathematically correct (1/leverage), bar widths and USD amounts show relative density across tiers modeled from open interest.
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
