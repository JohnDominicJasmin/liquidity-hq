'use client';
import { useState, useEffect, useCallback } from 'react';
import { CoinId, COINS, BINANCE_SYMS, BYBIT_SYMS, useMarket } from '@/lib/marketStore';

interface CoinOI { coin: CoinId; pct: number | null; oiUsd: number | null }

const TREND_SIG: Record<string, { label: string; col: string }> = {
  strong_up:   { label: 'NEW LONGS ▲',  col: '#34d399' },
  strong_down: { label: 'NEW SHORTS ▼', col: '#f87171' },
  weak_up:     { label: 'SHORT COVER',  col: '#86efac' },
  weak_down:   { label: 'LONG EXITS',   col: '#fca5a5' },
};

function fmtOIUsd(v: number | null): string {
  if (v == null) return '';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
}

export default function OISpikeScanner() {
  const { store } = useMarket();
  const [rows, setRows]         = useState<CoinOI[]>([]);
  const [loading, setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const settled = await Promise.allSettled(
      COINS.map(async (coin): Promise<CoinOI> => {
        try {
          const bin = BINANCE_SYMS[coin];
          const bbt = BYBIT_SYMS[coin];

          if (bin) {
            const r = await fetch(
              `https://fapi.binance.com/futures/data/openInterestHist?symbol=${bin}&period=5m&limit=13`,
              { cache: 'no-store' }
            );
            if (!r.ok) return { coin, pct: null, oiUsd: null };
            const d = await r.json() as Array<{ sumOpenInterest: string; sumOpenInterestValue: string }>;
            if (d.length < 2) return { coin, pct: null, oiUsd: null };
            const newest = parseFloat(d[d.length - 1].sumOpenInterest);
            const oldest = parseFloat(d[0].sumOpenInterest);
            return {
              coin,
              pct:   oldest > 0 ? (newest - oldest) / oldest * 100 : null,
              oiUsd: parseFloat(d[d.length - 1].sumOpenInterestValue),
            };
          }

          if (bbt) {
            const r = await fetch(
              `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${bbt}&intervalTime=5min&limit=13`,
              { cache: 'no-store' }
            );
            if (!r.ok) return { coin, pct: null, oiUsd: null };
            const d = await r.json() as { result?: { list?: Array<{ openInterest: string }> } };
            const list = d.result?.list ?? [];
            if (list.length < 2) return { coin, pct: null, oiUsd: null };
            const newest = parseFloat(list[0].openInterest);            // Bybit: newest first
            const oldest = parseFloat(list[list.length - 1].openInterest);
            return {
              coin,
              pct:   oldest > 0 ? (newest - oldest) / oldest * 100 : null,
              oiUsd: newest,
            };
          }

          return { coin, pct: null, oiUsd: null };
        } catch {
          return { coin, pct: null, oiUsd: null };
        }
      })
    );

    const result: CoinOI[] = settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : { coin: COINS[i], pct: null, oiUsd: null }
    );

    // Sort: biggest absolute move first, nulls last
    result.sort((a, b) => {
      if (a.pct == null && b.pct == null) return 0;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return Math.abs(b.pct) - Math.abs(a.pct);
    });

    setRows(result);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  const agoStr = updatedAt
    ? (() => {
        const s = Math.floor((Date.now() - updatedAt) / 1000);
        return s < 60 ? 'just now' : `${Math.floor(s / 60)}m ago`;
      })()
    : null;

  return (
    <div className="ois-card">

      {/* ── Header ── */}
      <div className="ois-header">
        <span className="ois-title">OI Spike Scanner · 1H</span>
        <span className="ois-age">{loading ? 'Loading…' : agoStr}</span>
      </div>

      {/* ── Rows ── */}
      {rows.map(({ coin, pct, oiUsd }) => {
        const coinData = store.coins[coin];
        const trend    = coinData?.oiTrend as string | undefined;
        const sig      = trend ? TREND_SIG[trend] : null;

        const isSpike   = pct != null && Math.abs(pct) >= 10;
        const isNotable = pct != null && Math.abs(pct) >= 5 && !isSpike;

        const pctCol = pct == null    ? 'var(--txt3)'
          : pct >= 10                 ? '#34d399'
          : pct >= 5                  ? '#86efac'
          : pct <= -10                ? '#f87171'
          : pct <= -5                 ? '#fca5a5'
          :                             'var(--txt3)';

        const sigLabel = sig?.label
          ?? (pct != null && Math.abs(pct) >= 2 ? (pct > 0 ? 'Rising' : 'Unwinding') : 'Stable');
        const sigCol   = sig?.col ?? 'var(--txt3)';

        // Bybit OI history returns contracts (base asset), not USD — multiply by live price
        const displayOiUsd = oiUsd != null && !BINANCE_SYMS[coin]
          ? (coinData?.price ? oiUsd * coinData.price : null)
          : oiUsd;

        return (
          <div
            key={coin}
            className={`ois-row${isSpike ? ' ois-row-spike' : isNotable ? ' ois-row-notable' : ''}`}
          >
            {/* Pulse dot */}
            <span
              className="ois-dot"
              style={{
                background:  isSpike   ? pctCol : isNotable ? pctCol + 'aa' : 'var(--bdr2)',
                boxShadow:   isSpike   ? `0 0 6px ${pctCol}` : 'none',
              }}
            />

            {/* Coin */}
            <span className="ois-coin">{coin.toUpperCase()}</span>

            {/* OI USD — hidden on very small screens */}
            <span className="ois-oi-usd">{fmtOIUsd(displayOiUsd)}</span>

            {/* Pct change */}
            <span className="ois-pct" style={{ color: pctCol }}>
              {pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}
            </span>

            {/* Signal label */}
            <span className="ois-signal" style={{ color: sigCol }}>{sigLabel}</span>

            {/* Spike badge */}
            {isSpike && (
              <span
                className="ois-spike-badge"
                style={{ color: pctCol, background: pctCol + '18', border: `0.5px solid ${pctCol}44` }}
              >
                SPIKE
              </span>
            )}
          </div>
        );
      })}

      {/* ── Footer ── */}
      <div className="ois-footer">
        ≥10% = spike · New Longs/Shorts = real money entering · Short Cover/Long Exits = unwinding
      </div>
    </div>
  );
}
