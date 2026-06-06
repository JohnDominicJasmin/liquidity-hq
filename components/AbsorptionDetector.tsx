'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

/* ── Config ── */
const POLL_MS   = 2000;   // poll every 2s
const SNAP_MAX  = 30;     // keep 30 snaps = 60s of history
const WALL_MULT = 3;      // wall = qty > 3× median of that side

type Coin = 'btc' | 'eth';
const SYMBOLS: Record<Coin, string> = { btc: 'BTCUSDT', eth: 'ETHUSDT' };

interface Level { price: number; qty: number }
interface BookSnap { ts: number; bids: Level[]; asks: Level[]; mid: number }

export type WallStatus = 'holding' | 'reinforcing' | 'absorbing' | 'breaking';
interface WallInfo {
  side:        'BID' | 'ASK';
  price:       number;
  currentQty:  number;
  peakQty:     number;
  absorbedPct: number;   // % of peak qty eaten (positive = smaller)
  distPct:     number;   // % distance from mid
  status:      WallStatus;
}

/* ── Median of an array ── */
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/* ── Detect and score walls ── */
function analyseWalls(snaps: BookSnap[]): WallInfo[] {
  if (snaps.length < 3) return [];
  const latest = snaps[snaps.length - 1];
  const mid    = latest.mid;
  if (!mid) return [];

  function wallsOnSide(levels: Level[], side: 'BID' | 'ASK'): WallInfo[] {
    if (!levels.length) return [];
    const medQty    = median(levels.map(l => l.qty));
    const threshold = medQty * WALL_MULT;
    return levels
      .filter(l => l.qty >= threshold)
      .map(wall => {
        const p = wall.price;
        // Track this price across history (allow ±0.02% slippage)
        const history = snaps.map(snap => {
          const src = side === 'BID' ? snap.bids : snap.asks;
          return src.find(l => Math.abs(l.price - p) / p < 0.0002)?.qty ?? 0;
        });
        const currentQty  = history[history.length - 1];
        const peakQty     = Math.max(...history);
        const firstQty    = history.find(q => q > 0) ?? currentQty;
        const absorbedPct = peakQty > 0 ? (peakQty - currentQty) / peakQty * 100 : 0;
        const growthPct   = firstQty  > 0 ? (currentQty - firstQty) / firstQty * 100 : 0;
        const distPct     = Math.abs(p - mid) / mid * 100;

        let status: WallStatus;
        if (growthPct   > 25)  status = 'reinforcing';
        else if (absorbedPct > 60) status = 'breaking';
        else if (absorbedPct > 20) status = 'absorbing';
        else                        status = 'holding';

        return { side, price: p, currentQty, peakQty, absorbedPct, distPct, status };
      });
  }

  const allWalls = [
    ...wallsOnSide(latest.bids, 'BID'),
    ...wallsOnSide(latest.asks, 'ASK'),
  ];

  // Sort: closest to price first, then by significance (absorbed most = most interesting)
  return allWalls
    .sort((a, b) => a.distPct - b.distPct || b.absorbedPct - a.absorbedPct)
    .slice(0, 7);
}

function fmtQty(qty: number, coin: Coin): string {
  if (qty >= 1000) return (qty / 1000).toFixed(1) + 'K ' + coin.toUpperCase();
  if (qty < 1)     return qty.toFixed(3) + ' ' + coin.toUpperCase();
  return qty.toFixed(1) + ' ' + coin.toUpperCase();
}

const STATUS_META: Record<WallStatus, { col: string; icon: string; label: string }> = {
  holding:     { col: '#34d399', icon: '🟢', label: 'Holding'     },
  reinforcing: { col: '#60a5fa', icon: '⬆️',  label: 'Reinforcing' },
  absorbing:   { col: '#fbbf24', icon: '🟡', label: 'Absorbing'   },
  breaking:    { col: '#f87171', icon: '🔴', label: 'Breaking'    },
};

export default function AbsorptionDetector({ coin = 'btc' as Coin }: { coin?: Coin }) {
  const [walls, setWalls]         = useState<WallInfo[]>([]);
  const [midPrice, setMidPrice]   = useState<number | null>(null);
  const [snapCount, setSnapCount] = useState(0);
  const [loading, setLoading]     = useState(true);

  const snapsRef   = useRef<BookSnap[]>([]);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/depth?symbol=${SYMBOLS[coin]}&limit=20`,
        { cache: 'no-store' }
      );
      if (!r.ok) return;
      const d = await r.json() as { bids: string[][]; asks: string[][] };

      const bids: Level[] = d.bids
        .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
        .sort((a, b) => b.price - a.price);
      const asks: Level[] = d.asks
        .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }))
        .sort((a, b) => a.price - b.price);
      const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : 0;

      snapsRef.current = [...snapsRef.current.slice(-(SNAP_MAX - 1)), { ts: Date.now(), bids, asks, mid }];

      if (mountedRef.current) {
        setWalls(analyseWalls(snapsRef.current));
        setMidPrice(mid || null);
        setSnapCount(snapsRef.current.length);
        setLoading(false);
      }
    } catch { /* silent */ }
  }, [coin]);

  useEffect(() => {
    mountedRef.current = true;
    snapsRef.current = [];
    setWalls([]);
    setLoading(true);
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [poll]);

  /* ── Derive key signal for the footer ── */
  const breakingAsk = walls.find(w => w.side === 'ASK' && (w.status === 'absorbing' || w.status === 'breaking'));
  const breakingBid = walls.find(w => w.side === 'BID' && (w.status === 'absorbing' || w.status === 'breaking'));

  return (
    <div className="absorb-card">

      {/* ── Header ── */}
      <div className="absorb-header">
        <div>
          <div className="absorb-title">Absorption Detector</div>
          <div className="absorb-sub">
            {coin.toUpperCase()} · walls &gt;{WALL_MULT}× median qty · {POLL_MS / 1000}s polling · {SNAP_MAX * POLL_MS / 1000}s window
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {midPrice != null && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
              ${midPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#333', marginTop: 2 }}>
            {snapCount < SNAP_MAX ? `${snapCount}/${SNAP_MAX} snaps` : `${SNAP_MAX * POLL_MS / 1000}s data`}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {loading || snapCount < 3 ? (
        <div className="absorb-empty">Building snapshot history… ({snapCount}/{SNAP_MAX})</div>
      ) : walls.length === 0 ? (
        <div className="absorb-empty">No significant walls detected — order book is thin or balanced</div>
      ) : (
        <>
          <div className="absorb-hdr">
            <div>Side</div>
            <div>Price</div>
            <div>Current / Peak</div>
            <div>Absorption</div>
            <div>Status</div>
          </div>

          {walls.map((w, i) => {
            const meta = STATUS_META[w.status];
            return (
              <div key={i} className="absorb-row">
                {/* Side badge */}
                <div className={`absorb-side-badge ${w.side === 'BID' ? 'absorb-bid' : 'absorb-ask'}`}>
                  {w.side}
                </div>

                {/* Price + distance */}
                <div>
                  <div className="absorb-price">
                    ${w.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="absorb-dist">{w.distPct.toFixed(2)}% from mid</div>
                </div>

                {/* Qty */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: meta.col, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtQty(w.currentQty, coin)}
                  </div>
                  {w.peakQty > w.currentQty && (
                    <div style={{ fontSize: 9, color: '#444', fontVariantNumeric: 'tabular-nums' }}>
                      peak {fmtQty(w.peakQty, coin)}
                    </div>
                  )}
                </div>

                {/* Absorption bar */}
                <div>
                  <div className="absorb-bar-wrap">
                    <div
                      className="absorb-bar-fill"
                      style={{ width: Math.min(w.absorbedPct, 100) + '%', background: meta.col }}
                    />
                  </div>
                  <div style={{ fontSize: 9, color: meta.col, marginTop: 2 }}>
                    {w.absorbedPct > 1 ? w.absorbedPct.toFixed(0) + '% eaten' : 'intact'}
                  </div>
                </div>

                {/* Status */}
                <div className="absorb-status" style={{ color: meta.col }}>
                  {meta.icon} {meta.label}
                </div>
              </div>
            );
          })}

          {/* ── Signal interpretation ── */}
          {breakingAsk && (
            <div className="absorb-signal absorb-signal-bull">
              ▲ Ask wall at ${breakingAsk.price.toLocaleString()} {breakingAsk.status === 'breaking' ? 'breaking' : 'absorbing'} — resistance weakening · watch for breakout above
            </div>
          )}
          {!breakingAsk && breakingBid && (
            <div className="absorb-signal absorb-signal-bear">
              ▼ Bid wall at ${breakingBid.price.toLocaleString()} {breakingBid.status === 'breaking' ? 'breaking' : 'absorbing'} — support weakening · watch for breakdown below
            </div>
          )}
        </>
      )}
    </div>
  );
}
