'use client';
import { useState, useMemo } from 'react';
import { useMarket, CoinId } from '@/lib/marketStore';

const COINS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'zec'];

/* ─── Leverage tiers ─────────────────────────────────────────────────────────
   dist  = % move from entry that triggers liquidation at this leverage
   weight = rough fraction of total OI sitting at this leverage tier
   Source: observed retail distribution on Binance/Bybit
   ─────────────────────────────────────────────────────────────────────────── */
const TIERS = [
  { lev: 100, dist: 0.010, w: 0.08 },
  { lev: 50,  dist: 0.020, w: 0.10 },
  { lev: 25,  dist: 0.040, w: 0.14 },
  { lev: 20,  dist: 0.050, w: 0.16 },
  { lev: 15,  dist: 0.067, w: 0.14 },
  { lev: 10,  dist: 0.100, w: 0.18 },
  { lev: 5,   dist: 0.200, w: 0.12 },
  { lev: 3,   dist: 0.330, w: 0.08 },
];

interface Band {
  price:    number;
  distPct:  number;
  usdM:     number;   // estimated $M liquidated if price reaches this level
  lev:      string;
  side:     'long' | 'short';
  barPct:   number;   // 0-100 for bar rendering
  isMagnet: boolean;  // nearest dense cluster
}

/* ─── Core computation ─────────────────────────────────────────────────────── */
function computeBands(
  price:  number,
  oi:     number,
  longR:  number,
  shortR: number,
): {
  longs:         Band[];
  shortsDisplay: Band[];   // ordered farthest→closest for top-to-bottom layout
  magnetLong:    Band | null;
  magnetShort:   Band | null;
  totalLongM:    number;
  totalShortM:   number;
} {
  const oiM = oi / 1e6;

  const longs: Band[] = TIERS.map(t => ({
    price:    price * (1 - t.dist),
    distPct:  t.dist * 100,
    usdM:     oiM * longR * t.w,
    lev:      `${t.lev}x`,
    side:     'long' as const,
    barPct:   0,
    isMagnet: false,
  }));

  const shorts: Band[] = TIERS.map(t => ({
    price:    price * (1 + t.dist),
    distPct:  t.dist * 100,
    usdM:     oiM * shortR * t.w,
    lev:      `${t.lev}x`,
    side:     'short' as const,
    barPct:   0,
    isMagnet: false,
  }));

  // Normalise bar widths relative to the global max
  const maxUSD = Math.max(...longs.map(b => b.usdM), ...shorts.map(b => b.usdM), 1);
  [...longs, ...shorts].forEach(b => { b.barPct = (b.usdM / maxUSD) * 100; });

  // Magnet = nearest high-density cluster within 10% of current price
  const nearL = longs.filter(b => b.distPct <= 10).sort((a, b) => b.usdM - a.usdM)[0] ?? null;
  const nearS = shorts.filter(b => b.distPct <= 10).sort((a, b) => b.usdM - a.usdM)[0] ?? null;
  if (nearL) nearL.isMagnet = true;
  if (nearS) nearS.isMagnet = true;

  return {
    longs,
    shortsDisplay:  [...shorts].reverse(), // farthest first → closest is nearest to current price line
    magnetLong:     nearL,
    magnetShort:    nearS,
    totalLongM:     longs.reduce((s, b) => s + b.usdM, 0),
    totalShortM:    shorts.reduce((s, b) => s + b.usdM, 0),
  };
}

/* ─── Formatters ────────────────────────────────────────────────────────────── */
function fmtP(price: number): string {
  if (price >= 10_000) return '$' + Math.round(price).toLocaleString('en-US');
  if (price >= 100)    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1)      return '$' + price.toFixed(3);
  return '$' + price.toFixed(4);
}

function fmtM(v: number): string {
  if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'B';
  return '$' + Math.round(v) + 'M';
}

/* ─── Band Row ──────────────────────────────────────────────────────────────── */
function BandRow({ b }: { b: Band }) {
  const isLong   = b.side === 'long';
  const accent   = isLong ? '#f87171' : '#34d399';
  const gradFrom = isLong ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.10)';
  const gradTo   = isLong ? 'rgba(248,113,113,0.60)' : 'rgba(52,211,153,0.60)';

  return (
    <div className={`liq-row${b.isMagnet ? ' liq-row-magnet' : ''}`}>
      <span className="liq-row-price">{fmtP(b.price)}</span>

      <span className="liq-row-lev" style={{ color: accent }}>
        {b.lev}{b.isMagnet ? ' 🧲' : ''}
      </span>

      <div className="liq-row-bar-wrap">
        <div
          className="liq-row-bar"
          style={{
            width: Math.max(b.barPct, 2) + '%',
            background: `linear-gradient(90deg, ${gradFrom}, ${gradTo})`,
            boxShadow: b.isMagnet ? `0 0 10px ${accent}44` : 'none',
          }}
        />
      </div>

      <span className="liq-row-usd" style={{ color: accent }}>{fmtM(b.usdM)}</span>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function LiqPage() {
  const { store }  = useMarket();
  const [coin, setCoin] = useState<CoinId>('btc');
  const cd = store.coins[coin];

  const bands = useMemo(() => {
    if (!cd?.price || !cd?.oi) return null;
    return computeBands(cd.price, cd.oi, cd.longRatio ?? 0.5, cd.shortRatio ?? 0.5);
  }, [cd?.price, cd?.oi, cd?.longRatio, cd?.shortRatio]);

  /* Bias: which side has more $ at risk — tells you who whales will hunt */
  const bias = bands
    ? bands.totalLongM > bands.totalShortM * 1.15
      ? { txt: 'Long-heavy', sub: 'More long liq below — whales incentivised to dump', col: '#f87171' }
      : bands.totalShortM > bands.totalLongM * 1.15
      ? { txt: 'Short-heavy', sub: 'More short liq above — whales incentivised to pump', col: '#34d399' }
      : { txt: 'Balanced', sub: 'Roughly equal long/short liq risk on both sides', col: '#606060' }
    : null;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>
          🔥 Liquidation Heatmap
        </div>
        <div style={{ fontSize: 12, color: '#606060' }}>
          Estimated liq zones · OI × leverage tiers · nearest dense cluster = price magnet
        </div>
      </div>

      {/* Coin selector */}
      <div className="arena-coin-row" style={{ marginBottom: 14 }}>
        {COINS.map(c => (
          <button
            key={c}
            className={`arena-coin-btn${coin === c ? ' sel' : ''}`}
            onClick={() => setCoin(c)}
          >
            {c.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Loading / no-data states */}
      {!cd?.price && (
        <div className="card" style={{ textAlign: 'center', color: '#444', padding: '2rem' }}>
          Loading {coin.toUpperCase()} data…
        </div>
      )}
      {cd?.price && !cd?.oi && (
        <div className="card" style={{ textAlign: 'center', color: '#444', padding: '2rem' }}>
          No open interest data available for {coin.toUpperCase()}
        </div>
      )}

      {bands && cd?.price && cd?.oi && (
        <>
          {/* Risk stats row */}
          <div className="liq-stats-row">
            <div className="liq-stat-item">
              <div className="liq-stat-label">Long liq risk (dump)</div>
              <div className="liq-stat-val" style={{ color: '#f87171' }}>{fmtM(bands.totalLongM)}</div>
              <div className="liq-stat-sub">
                L/S: {((cd.longRatio ?? 0.5) * 100).toFixed(0)}% / {((cd.shortRatio ?? 0.5) * 100).toFixed(0)}%
              </div>
            </div>
            <div className="liq-stat-sep" />
            <div className="liq-stat-item" style={{ textAlign: 'right' }}>
              <div className="liq-stat-label">Short squeeze (pump)</div>
              <div className="liq-stat-val" style={{ color: '#34d399' }}>{fmtM(bands.totalShortM)}</div>
              <div className="liq-stat-sub" style={{ textAlign: 'right' }}>
                OI: {fmtM(cd.oi / 1e6)}
              </div>
            </div>
          </div>

          {/* Bias card */}
          {bias && (
            <div className="liq-bias-card" style={{ borderColor: `${bias.col}33` }}>
              <span className="liq-bias-badge" style={{ color: bias.col, background: `${bias.col}16` }}>
                {bias.txt}
              </span>
              <span className="liq-bias-sub">{bias.sub}</span>
            </div>
          )}

          {/* Magnets callout */}
          {(bands.magnetLong || bands.magnetShort) && (
            <div className="liq-magnet-box">
              <span style={{ fontSize: 20, flexShrink: 0 }}>🧲</span>
              <div>
                <div className="liq-magnet-box-title">Nearest Liquidity Magnets</div>
                <div className="liq-magnet-box-body">
                  {bands.magnetShort && (
                    <span style={{ color: '#34d399' }}>
                      Short squeeze {fmtP(bands.magnetShort.price)} (+{bands.magnetShort.distPct.toFixed(1)}%, {fmtM(bands.magnetShort.usdM)} at risk)
                    </span>
                  )}
                  {bands.magnetLong && bands.magnetShort && (
                    <span style={{ color: '#444', margin: '0 6px' }}>·</span>
                  )}
                  {bands.magnetLong && (
                    <span style={{ color: '#f87171' }}>
                      Long wipeout {fmtP(bands.magnetLong.price)} (-{bands.magnetLong.distPct.toFixed(1)}%, {fmtM(bands.magnetLong.usdM)} at risk)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Main heatmap ─────────────────────────────── */}
          <div className="liq-card">

            {/* Short squeeze section — top (farthest first) */}
            <div className="liq-section-hdr liq-section-hdr-short">
              <span>↑ SHORT SQUEEZE ZONES</span>
              <span className="liq-section-sub">price pumps → shorts get force-closed</span>
            </div>
            {bands.shortsDisplay.map((b, i) => <BandRow key={`s${i}`} b={b} />)}

            {/* Current price bar */}
            <div className="liq-current-bar">
              <span className="liq-current-dot" />
              <span className="liq-current-price">{fmtP(cd.price)}</span>
              <span className="liq-current-chg" style={{
                color: (cd.change ?? 0) >= 0 ? '#34d399' : '#f87171',
              }}>
                {(cd.change ?? 0) >= 0 ? '+' : ''}{(cd.change ?? 0).toFixed(2)}%
              </span>
              <span className="liq-current-tag">LIVE</span>
              <span className="liq-current-oi">{fmtM(cd.oi / 1e6)} OI</span>
            </div>

            {/* Long liq section — bottom (closest first) */}
            <div className="liq-section-hdr liq-section-hdr-long">
              <span>↓ LONG LIQUIDATION ZONES</span>
              <span className="liq-section-sub">price dumps → longs get force-closed</span>
            </div>
            {bands.longs.map((b, i) => <BandRow key={`l${i}`} b={b} />)}

          </div>

          {/* Legend */}
          <div className="liq-howto">
            <div className="liq-howto-title">How to read this</div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#34d399' }} />
              <span>
                <strong style={{ color: '#34d399' }}>Short Squeeze Zones</strong>{' '}
                — price levels above current where short positions get force-closed.
                Whales can push price UP into these to trigger a cascade of buy orders.
              </span>
            </div>
            <div className="liq-howto-row">
              <span className="liq-howto-dot" style={{ background: '#f87171' }} />
              <span>
                <strong style={{ color: '#f87171' }}>Long Liq Zones</strong>{' '}
                — price levels below current where long positions get force-closed.
                Whales dump DOWN into these to sweep stop-losses, then buy cheaper.
              </span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>🧲</span>
              <span>
                <strong>Magnet</strong>{' '}
                — nearest dense cluster within ±10%. Price is most likely to be pulled
                here on the next big move. Use as your raid target.
              </span>
            </div>
            <div className="liq-howto-row">
              <span style={{ flexShrink: 0 }}>📏</span>
              <span>
                <strong>Bar width</strong>{' '}
                — relative dollar value at risk. Wider = more $ gets liquidated
                if price reaches that level = stronger magnet effect.
              </span>
            </div>
          </div>

          <div className="liq-disclaimer">
            ⚠️ Estimated from live OI × leverage tier weights (100x → 3x). Long/short split from
            Binance L/S ratio. Wider bars = more money at risk = stronger price magnet.
            For exact data use Coinglass Liquidation Heatmap.
          </div>
        </>
      )}
    </div>
  );
}
