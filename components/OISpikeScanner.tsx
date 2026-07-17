'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

const PREVIEW = 5;

export default function OISpikeScanner() {
  const { store } = useMarket();
  const [rows, setRows]           = useState<CoinOI[]>([]);
  const [loading, setLoading]     = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [expanded, setExpanded]   = useState(false);
  const [search, setSearch]       = useState('');
  const searchRef                 = useRef<HTMLInputElement>(null);

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

  // Sort by display OI USD descending; Bybit oiUsd is in contracts so multiply by live price
  const sortedRows = useMemo(() => [...rows].sort((a, b) => {
    const toUsd = (r: CoinOI) => {
      if (r.oiUsd == null) return null;
      if (!BINANCE_SYMS[r.coin]) {
        const price = store.coins[r.coin]?.price;
        return price ? r.oiUsd * price : null;
      }
      return r.oiUsd;
    };
    const av = toUsd(a), bv = toUsd(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  }), [rows, store.coins]);

  const spikeCount = sortedRows.filter(r => r.pct != null && Math.abs(r.pct) >= 10).length;

  const displayRows = expanded
    ? sortedRows.filter(r => search ? r.coin.toLowerCase().includes(search.toLowerCase()) : true)
    : sortedRows.slice(0, PREVIEW);

  const toggle = () => {
    setExpanded(prev => {
      if (prev) setSearch('');
      return !prev;
    });
    if (!expanded) setTimeout(() => searchRef.current?.focus(), 60);
  };

  const renderRow = ({ coin, pct, oiUsd }: CoinOI) => {
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
    const sigCol = sig?.col ?? 'var(--txt3)';

    const displayOiUsd = oiUsd != null && !BINANCE_SYMS[coin]
      ? (coinData?.price ? oiUsd * coinData.price : null)
      : oiUsd;

    return (
      <div
        key={coin}
        className={`ois-row${isSpike ? ' ois-row-spike' : isNotable ? ' ois-row-notable' : ''}`}
      >
        <span
          className="ois-dot"
          style={{
            background: isSpike ? pctCol : isNotable ? pctCol + 'aa' : 'var(--bdr2)',
            boxShadow:  isSpike ? `0 0 6px ${pctCol}` : 'none',
          }}
        />
        <span className="ois-coin">{coin.toUpperCase()}</span>
        <span className="ois-oi-usd">{fmtOIUsd(displayOiUsd)}</span>
        <span className="ois-pct" style={{ color: pctCol }}>
          {pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '-'}
        </span>
        <span className="ois-signal" style={{ color: sigCol }}>{sigLabel}</span>
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
  };

  return (
    <div className="ois-card">

      {/* ── Header ── */}
      <div className="ois-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ois-title">Open Interest Spike Scanner · 1H</span>
          {!loading && spikeCount > 0 && (
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.05em',
              color: '#34d399', background: 'rgba(52,211,153,0.1)',
              border: '0.5px solid rgba(52,211,153,0.25)',
              padding: '1px 5px', borderRadius: 4,
            }}>
              {spikeCount} SPIKE{spikeCount !== 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <span className="ois-age">{loading ? 'Loading…' : agoStr}</span>
      </div>

      {/* ── Search bar - visible only when expanded ── */}
      {expanded && (
        <div style={{ borderBottom: '0.5px solid var(--bdr)', padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search coins…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '8px 0',
              fontSize: 'var(--fs-caption)',
              color: 'var(--txt)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--txt3)', fontSize: '0.8125rem', lineHeight: 1 }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* ── Rows ── */}
      <div style={expanded ? { maxHeight: 300, overflowY: 'auto' } : {}}>
        {displayRows.length > 0
          ? displayRows.map(renderRow)
          : <div style={{ padding: '12px 14px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>No coins match &ldquo;{search}&rdquo;</div>
        }
      </div>

      {/* ── Expand / collapse toggle ── */}
      {sortedRows.length > PREVIEW && (
        <button
          onClick={toggle}
          aria-expanded={expanded}
          style={{
            width: '100%',
            padding: '7px 14px',
            background: 'transparent',
            border: 'none',
            borderTop: '0.5px solid var(--bdr)',
            cursor: 'pointer',
            fontSize: 'var(--fs-caption)',
            color: 'var(--txt3)',
            letterSpacing: '.03em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {expanded
            ? '▲ Show less'
            : `▼ Show all ${sortedRows.length} coins`
          }
        </button>
      )}
    </div>
  );
}
