'use client';
import { useState, useMemo } from 'react';
import { useMarket, CoinId } from '@/lib/marketStore';
import LiqFeed from '@/components/LiqFeed';

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'];

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

const RANGES: { key: TimeRange; label: string; maxDist: number; hint: string }[] = [
  { key: '12h', label: '12h',    maxDist: 0.05,  hint: 'Intraday scalp · ±5% · 125x → 20x' },
  { key: '24h', label: '24h',    maxDist: 0.10,  hint: 'Day trade · ±10% · 125x → 10x' },
  { key: '48h', label: '48h',    maxDist: 0.13,  hint: '2-day swing · ±13% · 125x → 8x' },
  { key: '3d',  label: '3 days', maxDist: 0.25,  hint: 'Multi-day swing · ±25% · 125x → 4x' },
  { key: '1w',  label: '1 week', maxDist: 0.50,  hint: 'Full weekly · ±50% · all 17 tiers' },
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

/* ─── Estimated band row ───────────────────────────────────────────────────── */
function BandRow({ b }: { b: Band }) {
  const isLong = b.side === 'long';
  const accent = isLong ? '#f87171' : '#34d399';
  return (
    <div className={`liq-row${b.isMagnet ? ' liq-row-magnet' : ''}`}>
      <span className="liq-row-price">{fmtP(b.price)}</span>
      <span className="liq-row-dist" style={{ color: '#444' }}>
        {b.distPct < 1 ? b.distPct.toFixed(1) : Math.round(b.distPct)}%
      </span>
      <span className="liq-row-lev" style={{ color: accent }}>
        {b.lev}{b.isMagnet ? ' 🧲' : ''}
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

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function LiqPage() {
  const { store }  = useMarket();
  const [coin, setCoin]   = useState<CoinId>('btc');
  const [range, setRange] = useState<TimeRange>('24h');

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
      ? { txt: 'Long-heavy', sub: 'More long liq below — whales incentivised to dump', col: '#f87171' }
      : bands.totalShortM > bands.totalLongM * 1.15
      ? { txt: 'Short-heavy', sub: 'More short liq above — whales incentivised to pump', col: '#34d399' }
      : { txt: 'Balanced', sub: 'Roughly equal liq risk on both sides', col: '#606060' }
    : null;

  return (
    <div>
      {/* Live Liquidation Feed */}
      <LiqFeed />

      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>
          🔥 Liquidation Heatmap
        </div>
        <div style={{ fontSize: 12, color: '#606060' }}>
          Estimated liquidation zones · nearest dense cluster = price magnet
        </div>
      </div>

      {/* Coin selector */}
      <div className="arena-coin-row" style={{ marginBottom: 12 }}>
        {COINS.map(c => (
          <button key={c} className={`arena-coin-btn${coin === c ? ' sel' : ''}`} onClick={() => setCoin(c)}>
            {c.toUpperCase()}
          </button>
        ))}
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
          {/* Stats row */}
          <div className="liq-stats-row">
            <div className="liq-stat-item">
              <div className="liq-stat-label">Long liq risk (dump)</div>
              <div className="liq-stat-val" style={{ color: '#f87171' }}>{fmtM(bands.totalLongM)}</div>
              <div className="liq-stat-sub">L/S: {((cd.longRatio ?? 0.5)*100).toFixed(0)}% / {((cd.shortRatio ?? 0.5)*100).toFixed(0)}%</div>
            </div>
            <div className="liq-stat-sep" />
            <div className="liq-stat-item" style={{ textAlign: 'center' }}>
              <div className="liq-stat-label" style={{ textAlign: 'center' }}>Tiers shown</div>
              <div className="liq-stat-val" style={{ color: '#a78bfa', textAlign: 'center' }}>
                {bands.tierCount}<span style={{ fontSize: 11, color: '#444', fontWeight: 500 }}>/17</span>
              </div>
              <div className="liq-stat-sub" style={{ textAlign: 'center' }}>{range} window</div>
            </div>
            <div className="liq-stat-sep" />
            <div className="liq-stat-item" style={{ textAlign: 'right' }}>
              <div className="liq-stat-label">Short squeeze (pump)</div>
              <div className="liq-stat-val" style={{ color: '#34d399' }}>{fmtM(bands.totalShortM)}</div>
              <div className="liq-stat-sub" style={{ textAlign: 'right' }}>OI: {fmtM(cd.oi / 1e6)}</div>
            </div>
          </div>

          {/* Bias */}
          {bias && (
            <div className="liq-bias-card" style={{ borderColor: `${bias.col}33` }}>
              <span className="liq-bias-badge" style={{ color: bias.col, background: `${bias.col}16` }}>{bias.txt}</span>
              <span className="liq-bias-sub">{bias.sub}</span>
            </div>
          )}

          {/* Magnets */}
          {(bands.magnetLong || bands.magnetShort) && (
            <div className="liq-magnet-box">
              <span style={{ fontSize: 20, flexShrink: 0 }}>🧲</span>
              <div>
                <div className="liq-magnet-box-title">Largest Clusters · {rangeConf.label} window</div>
                <div className="liq-magnet-box-body">
                  {bands.magnetShort && (
                    <span style={{ color: '#34d399' }}>
                      Short squeeze {fmtP(bands.magnetShort.price)} (+{bands.magnetShort.distPct.toFixed(1)}%, {fmtM(bands.magnetShort.usdM)} at risk)
                    </span>
                  )}
                  {bands.magnetLong && bands.magnetShort && <span style={{ color: '#444', margin: '0 6px' }}>·</span>}
                  {bands.magnetLong && (
                    <span style={{ color: '#f87171' }}>
                      Long wipeout {fmtP(bands.magnetLong.price)} (-{bands.magnetLong.distPct.toFixed(1)}%, {fmtM(bands.magnetLong.usdM)} at risk)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ ESTIMATED HEATMAP ══════════════════════════════════ */}
          <div className="liq-card">
            <div className="liq-section-hdr liq-section-hdr-short">
              <span>↑ SHORT SQUEEZE ZONES</span>
              <span className="liq-section-sub">price pumps → shorts force-closed · {rangeConf.label}</span>
            </div>
            <div className="liq-col-hdr">
              <span>Price</span><span>Away</span><span>Lev</span>
              <span style={{ flex: 1 }}>Liq density (estimated)</span><span>Est. $</span>
            </div>
            {bands.shortsDisplay.map((b, i) => <BandRow key={`s${i}`} b={b} />)}

            <div className="liq-current-bar">
              <span className="liq-current-dot" />
              <span className="liq-current-price">{fmtP(cd.price)}</span>
              <span className="liq-current-chg" style={{ color: (cd.change ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                {(cd.change ?? 0) >= 0 ? '+' : ''}{(cd.change ?? 0).toFixed(2)}%
              </span>
              <span className="liq-current-tag">LIVE</span>
              <span className="liq-current-oi">{fmtM(cd.oi / 1e6)} OI</span>
            </div>

            <div className="liq-section-hdr liq-section-hdr-long">
              <span>↓ LONG LIQUIDATION ZONES</span>
              <span className="liq-section-sub">price dumps → longs force-closed · {rangeConf.label}</span>
            </div>
            {bands.longs.map((b, i) => <BandRow key={`l${i}`} b={b} />)}
          </div>

          {/* Legend */}
          <div className="liq-howto">
            <div className="liq-howto-title">How to read this</div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#34d399' }} />
              <span><strong style={{ color: '#34d399' }}>Short Squeeze Zones (estimated)</strong> — price levels above current where modelled short positions get force-closed. Whales push price UP into these.</span>
            </div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#f87171' }} />
              <span><strong style={{ color: '#f87171' }}>Long Liq Zones (estimated)</strong> — price levels below current where modelled long positions get force-closed. Whales dump DOWN into these.</span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>🧲</span>
              <span><strong>Magnet</strong> — largest estimated cluster in selected window. Most likely price target for the next big move.</span>
            </div>
          </div>

          <div className="liq-disclaimer">
            Estimated bands: live OI × leverage tier weights (17 tiers).
            For full historical heatmap data use Coinglass (paid API).
          </div>
        </>
      )}
    </div>
  );
}
