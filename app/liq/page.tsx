'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useMarket, CoinId, BINANCE_SYMS } from '@/lib/marketStore';

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

/* ─── Real liquidation bucket (from Binance allForceOrders) ────────────────── */
interface RealBucket {
  price:    number;
  longUSD:  number;   // SELL orders = long position force-closed
  shortUSD: number;   // BUY  orders = short position force-closed
  totalUSD: number;
  count:    number;
  pct:      number;   // 0-100 for bar width, relative to hottest bucket
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

/* ─── Real liq bucket row ──────────────────────────────────────────────────── */
function RealRow({ b, hot }: { b: RealBucket; hot: boolean }) {
  const longDom  = b.longUSD > b.shortUSD * 1.3;
  const shortDom = b.shortUSD > b.longUSD * 1.3;
  const accent   = longDom ? '#f87171' : shortDom ? '#34d399' : '#fbbf24';
  const tag      = longDom ? 'LONG' : shortDom ? 'SHORT' : 'MIXED';

  return (
    <div className={`liq-real-row${hot ? ' liq-real-hot' : ''}`}>
      <span className="liq-real-price">{fmtP(b.price)}</span>

      {/* Stacked split bar: red = long liq | green = short liq */}
      <div className="liq-real-bar-wrap">
        <div className="liq-real-bar-inner" style={{ width: Math.max(b.pct, 2) + '%' }}>
          {b.longUSD  > 0 && <div style={{ flex: b.longUSD,  background: 'rgba(248,113,113,0.72)', height: '100%' }} />}
          {b.shortUSD > 0 && <div style={{ flex: b.shortUSD, background: 'rgba(52,211,153,0.72)',  height: '100%' }} />}
        </div>
      </div>

      <span className="liq-real-tag" style={{ color: accent }}>{hot ? '🔥 ' : ''}{tag}</span>
      <span className="liq-real-total" style={{ color: accent }}>{fmtM(b.totalUSD)}</span>
      <span className="liq-real-count">{b.count}</span>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function LiqPage() {
  const { store }  = useMarket();
  const [coin, setCoin]   = useState<CoinId>('btc');
  const [range, setRange] = useState<TimeRange>('24h');

  /* Real liq state */
  const [realBuckets, setRealBuckets] = useState<RealBucket[]>([]);
  const [realLoading, setRealLoading] = useState(false);
  const [realErr,     setRealErr]     = useState('');
  const [realMeta,    setRealMeta]    = useState('');
  const [fetchedAt,   setFetchedAt]   = useState(0);

  const cd         = store.coins[coin];
  const rangeConf  = RANGES.find(r => r.key === range)!;

  /* ── Fetch real liq from Binance allForceOrders ── */
  const fetchReal = useCallback(async () => {
    const sym = (BINANCE_SYMS as Record<string, string>)[coin];
    if (!sym) {
      setRealErr(`${coin.toUpperCase()} trades on Bybit — Binance perp data unavailable`);
      setRealBuckets([]);
      return;
    }
    const curPrice = store.coins[coin]?.price;
    if (!curPrice) return;

    setRealLoading(true);
    setRealErr('');

    try {
      /* allForceOrders max limit = 100 per request.
         Paginate backward (up to 5 pages = 500 orders) for better coverage. */
      type Order = { price: string; avragePrice: string; executedQty: string; side: 'BUY' | 'SELL'; time: number };
      const data: Order[] = [];
      let endTime: number | undefined;
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({ symbol: sym, limit: '100' });
        if (endTime !== undefined) params.set('endTime', String(endTime));
        const res = await fetch(`https://fapi.binance.com/fapi/v1/allForceOrders?${params}`);
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(`Binance API error ${res.status}${errJson?.msg ? ': ' + errJson.msg : ''}`);
        }
        const batch: Order[] = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        data.push(...batch);
        const oldest = Math.min(...batch.map(o => o.time));
        if (oldest <= sevenDaysAgo || batch.length < 100) break;
        endTime = oldest - 1;
      }

      if (!Array.isArray(data) || data.length === 0) {
        setRealBuckets([]);
        setRealMeta('No liquidations in recent window');
        return;
      }

      /* Group into 0.3% price buckets */
      const BUCKET = curPrice * 0.003;
      const map = new Map<number, { long: number; short: number; count: number }>();

      for (const o of data) {
        const p   = parseFloat(o.avragePrice || o.price);
        const qty = parseFloat(o.executedQty);
        const usd = (p * qty) / 1_000_000;            // → $M
        const key = Math.round(p / BUCKET) * BUCKET;

        if (!map.has(key)) map.set(key, { long: 0, short: 0, count: 0 });
        const b = map.get(key)!;
        b.count++;
        /* SELL order = long position was force-closed (exchange sold to close long)
           BUY  order = short position was force-closed (exchange bought to close short) */
        if (o.side === 'SELL') b.long  += usd;
        else                   b.short += usd;
      }

      const vals       = Array.from(map.values());
      const maxTotal   = Math.max(...vals.map(v => v.long + v.short), 1);

      const buckets: RealBucket[] = Array.from(map.entries())
        .map(([price, b]) => ({
          price,
          longUSD:  b.long,
          shortUSD: b.short,
          totalUSD: b.long + b.short,
          count:    b.count,
          pct:      ((b.long + b.short) / maxTotal) * 100,
        }))
        .filter(b => b.totalUSD > 0.05)           // drop < $50k noise
        .sort((a, b) => b.price - a.price);        // highest price first

      /* Time window */
      const ts = data.map(o => o.time);
      const windowH = ((Math.max(...ts) - Math.min(...ts)) / 3_600_000).toFixed(1);
      const fetchTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      setRealMeta(`${data.length.toLocaleString()} orders · ~${windowH}h window · fetched ${fetchTime}`);
      setRealBuckets(buckets);
      setFetchedAt(Date.now());
    } catch (e) {
      setRealErr(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setRealLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  /* Auto-fetch when coin changes */
  useEffect(() => {
    setRealBuckets([]);
    setRealMeta('');
    setRealErr('');
    fetchReal();
  }, [coin]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* Real liq: split at current price */
  const curPrice      = cd?.price ?? 0;
  const realAbove     = realBuckets.filter(b => b.price >= curPrice);
  const realBelow     = realBuckets.filter(b => b.price <  curPrice);
  const hotAbove      = realAbove.length  ? realAbove.reduce((a, b)  => b.totalUSD > a.totalUSD ? b : a) : null;
  const hotBelow      = realBelow.length  ? realBelow.reduce((a, b)  => b.totalUSD > a.totalUSD ? b : a) : null;
  const hasRealData   = realBuckets.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>
          🔥 Liquidation Heatmap
        </div>
        <div style={{ fontSize: 12, color: '#606060' }}>
          Estimated zones + real Binance force orders · nearest dense cluster = price magnet
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

          {/* ══ REAL LIQ ACTIVITY (Binance allForceOrders) ════════ */}
          <div className="liq-real-card">
            {/* Header */}
            <div className="liq-real-hdr">
              <span>⚡ Real Liquidation Activity</span>
              <span className="liq-real-source">{realMeta || 'Binance Force Orders'}</span>
              <button
                className="liq-real-refresh-btn"
                onClick={fetchReal}
                disabled={realLoading}
                title="Refresh real liq data"
              >
                {realLoading ? '···' : '↻ Refresh'}
              </button>
            </div>

            {/* What this data is */}
            <div className="liq-real-explainer">
              <span style={{ color: '#f87171' }}>■</span> Long liq (SELL orders — forced closes of long positions)
              <span style={{ margin: '0 10px', color: '#2a2a2a' }}>|</span>
              <span style={{ color: '#34d399' }}>■</span> Short liq (BUY orders — forced closes of short positions)
              <span style={{ margin: '0 10px', color: '#2a2a2a' }}>|</span>
              <span style={{ color: '#fbbf24' }}>🔥</span> Hottest bucket in window
            </div>

            {/* Column header */}
            <div className="liq-real-col-hdr">
              <span>Price</span>
              <span>Swept liquidity</span>
              <span>Type</span>
              <span>Total</span>
              <span title="Number of force orders in this price bucket">n</span>
            </div>

            {/* Loading */}
            {realLoading && (
              <div style={{ padding: '18px', textAlign: 'center', color: '#444', fontSize: 12 }}>
                Fetching Binance allForceOrders (up to 5 × 100 orders)…
              </div>
            )}

            {/* Error */}
            {!realLoading && realErr && (
              <div style={{ padding: '10px 14px', color: '#f87171', fontSize: 11, lineHeight: 1.5 }}>
                {realErr}
              </div>
            )}

            {/* Empty */}
            {!realLoading && !realErr && fetchedAt > 0 && !hasRealData && (
              <div style={{ padding: '18px', textAlign: 'center', color: '#444', fontSize: 12 }}>
                No significant liquidations in the most recent 1 000 force orders
              </div>
            )}

            {/* Data rows — split at current price */}
            {!realLoading && hasRealData && (
              <>
                {/* Above current price: shorts got swept up here */}
                {realAbove.length > 0 && (
                  <div className="liq-real-zone-label liq-real-zone-short">
                    ↑ Short stops swept above · price pumped through here
                  </div>
                )}
                {realAbove.map(b => (
                  <RealRow key={b.price} b={b} hot={b === hotAbove} />
                ))}

                {/* Current price divider */}
                <div className="liq-real-price-bar">
                  <span className="liq-current-dot" style={{ width: 6, height: 6 }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#e8e8e8' }}>{fmtP(curPrice)}</span>
                  <span style={{ fontSize: 10, color: '#444', marginLeft: 6 }}>CURRENT PRICE</span>
                </div>

                {/* Below current price: longs got swept down here */}
                {realBelow.length > 0 && (
                  <div className="liq-real-zone-label liq-real-zone-long">
                    ↓ Long stops swept below · price dumped through here
                  </div>
                )}
                {realBelow.map(b => (
                  <RealRow key={b.price} b={b} hot={b === hotBelow} />
                ))}
              </>
            )}

            <div className="liq-real-footer">
              Source: Binance <code>/fapi/v1/allForceOrders</code> (up to 500 force orders via 5×100 pagination, public endpoint, no API key) ·
              Coverage window varies — volatile markets fill 500 orders in ~15 min, quiet markets in ~6h
            </div>
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
              <span style={{ flexShrink: 0 }}>⚡</span>
              <span><strong>Real Activity</strong> — actual Binance force-closed orders. Splits into long liq (red) and short liq (green) per price bucket. Hot bucket 🔥 = most $ in window.</span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>🧲</span>
              <span><strong>Magnet</strong> — largest estimated cluster in selected window. Most likely price target for the next big move.</span>
            </div>
          </div>

          <div className="liq-disclaimer">
            Estimated bands: live OI × leverage tier weights (17 tiers). Real activity: Binance allForceOrders, last 1 000 force orders.
            For full historical heatmap data use Coinglass (paid API).
          </div>
        </>
      )}
    </div>
  );
}
