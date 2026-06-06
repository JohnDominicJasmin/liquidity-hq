'use client';
import { useState, useEffect, useRef } from 'react';
import { useMarket, CoinId } from '@/lib/marketStore';

/* ── Endpoints ── */
const BINANCE_SYM: Partial<Record<CoinId, string>> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
const BYBIT_SYM: Partial<Record<CoinId, string>> = {
  hype: 'HYPEUSDT',
};

/* ── OI trend meta ── */
const OI_SIG: Record<string, { txt: string; col: string }> = {
  strong_up:   { txt: 'New longs — real trend ▲',     col: '#34d399' },
  strong_down: { txt: 'New shorts — real dump ▼',     col: '#f87171' },
  weak_up:     { txt: 'Short covering — weak pump',   col: '#fbbf24' },
  weak_down:   { txt: 'Long exits — no panic',        col: '#94a3b8' },
};

function fmtOI(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

interface OIData { oiUsd: number | null; pct: number | null }

export default function OISpikeScanner({
  coin,
  onData,
}: {
  coin: CoinId;
  onData?: (pct: number | null, signal: string) => void;
}) {
  const { store }               = useMarket();
  const [data, setData]         = useState<OIData>({ oiUsd: null, pct: null });
  const [updatedAt, setUpdated] = useState<number | null>(null);
  const [loading, setLoading]   = useState(true);

  const mountedRef  = useRef(true);
  const fetchingRef = useRef(false);

  useEffect(() => {
    mountedRef.current  = true;
    fetchingRef.current = false;
    setData({ oiUsd: null, pct: null });
    setLoading(true);

    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const binSym = BINANCE_SYM[coin];
        const bbtSym = BYBIT_SYM[coin];
        let result: OIData = { oiUsd: null, pct: null };

        if (binSym) {
          const r = await fetch(
            `https://fapi.binance.com/futures/data/openInterestHist?symbol=${binSym}&period=5m&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as Array<{ sumOpenInterest: string; sumOpenInterestValue: string }>;
            if (d.length >= 2) {
              const newest = parseFloat(d[d.length - 1].sumOpenInterest);
              const oldest = parseFloat(d[0].sumOpenInterest);
              result = {
                oiUsd: parseFloat(d[d.length - 1].sumOpenInterestValue),
                pct:   oldest > 0 ? (newest - oldest) / oldest * 100 : null,
              };
            }
          }
        } else if (bbtSym) {
          const r = await fetch(
            `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${bbtSym}&intervalTime=5min&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as { result?: { list?: Array<{ openInterest: string }> } };
            const list = d.result?.list ?? [];
            if (list.length >= 2) {
              const newest = parseFloat(list[0].openInterest);
              const oldest = parseFloat(list[list.length - 1].openInterest);
              result = {
                oiUsd: newest,
                pct:   oldest > 0 ? (newest - oldest) / oldest * 100 : null,
              };
            }
          }
        }

        if (mountedRef.current) {
          setData(result);
          setUpdated(Date.now());
          setLoading(false);
          if (onData) {
            // derive signal text for context
            const p = result.pct;
            const trend = store.coins[coin]?.oiTrend;
            const tMeta = trend ? OI_SIG[trend] : null;
            const isP = (p ?? 0) > 0;
            const isSpk = p != null && Math.abs(p) >= 10;
            let sig = '—';
            if (p != null) {
              if (isSpk) sig = tMeta ? tMeta.txt : (isP ? 'OI spike — rising' : 'OI spike — unwinding');
              else if (tMeta) sig = tMeta.txt;
              else if (Math.abs(p) < 2) sig = 'Stable';
              else sig = isP ? 'Rising' : 'Unwinding';
            }
            onData(p, sig);
          }
        }
      } catch {
        if (mountedRef.current) setLoading(false);
      } finally {
        fetchingRef.current = false;
      }
    };

    load();
    const iv = setInterval(load, 60_000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [coin]);

  /* ── Derived display values ── */
  const { oiUsd, pct } = data;
  const oiTrend   = store.coins[coin]?.oiTrend;
  const trendMeta = oiTrend ? OI_SIG[oiTrend] : null;

  const isPos   = (pct ?? 0) > 0;
  const isNeg   = (pct ?? 0) < 0;
  const isSpike = pct != null && Math.abs(pct) >= 10;

  const pctCol = pct == null      ? 'var(--txt3)'
    : isSpike && isPos            ? '#34d399'
    : isSpike && isNeg            ? '#f87171'
    : isPos                       ? '#86efac'
    : isNeg                       ? '#fca5a5'
    : 'var(--txt3)';

  let sigTxt = '—';
  let sigCol = 'var(--txt3)';
  if (pct != null) {
    if (isSpike) {
      sigTxt = trendMeta ? `🔥 ${trendMeta.txt}` : (isPos ? '🔥 OI spike — rising' : '🔥 OI spike — unwinding');
      sigCol = trendMeta?.col ?? (isPos ? '#34d399' : '#f87171');
    } else if (trendMeta) {
      sigTxt = trendMeta.txt;
      sigCol = trendMeta.col;
    } else if (Math.abs(pct) < 2) {
      sigTxt = 'Stable'; sigCol = 'var(--txt3)';
    } else {
      sigTxt = isPos ? 'Rising' : 'Unwinding';
      sigCol = isPos ? '#86efac' : '#fca5a5';
    }
  }

  /* bar: each half = 50% of track, max at 15% OI change */
  const BAR_MAX = 15;
  const halfBar = pct != null ? Math.min(Math.abs(pct) / BAR_MAX, 1) * 50 : 0;

  const ageSecs = updatedAt ? Math.floor((Date.now() - updatedAt) / 1000) : null;
  const ageStr  = ageSecs == null ? '' : ageSecs < 10 ? 'just now' : ageSecs < 60 ? `${ageSecs}s ago` : `${Math.floor(ageSecs / 60)}m ago`;

  return (
    <div className="ois-coin-card">
      {/* Header */}
      <div className="ois-coin-header">
        <span className="ois-coin-title">Open Interest · {coin.toUpperCase()}</span>
        <span className="ois-coin-age">{loading ? 'Loading…' : ageStr ? `Updated ${ageStr}` : '1h window · 5m snaps'}</span>
      </div>

      {/* Main row */}
      <div className="ois-coin-body">
        {/* OI value */}
        <div>
          <div className="ois-coin-value">
            {loading ? '—' : oiUsd != null ? fmtOI(oiUsd) : '—'}
          </div>
          <div className="ois-coin-label">Current OI</div>
        </div>

        {/* Pct + bar */}
        <div className="ois-coin-pct-col">
          <div className="ois-coin-pct" style={{ color: pctCol }}>
            {loading ? '—' : pct != null ? (isPos ? '+' : '') + pct.toFixed(2) + '%' : '—'}
          </div>
          <div className="ois-bar-wrap" style={{ margin: '4px 0' }}>
            {isPos && <div className="ois-bar-pos" style={{ width: halfBar + '%', background: pctCol }} />}
            {isNeg && <div className="ois-bar-neg" style={{ width: halfBar + '%', background: pctCol }} />}
          </div>
          <div className="ois-coin-label">1h change</div>
        </div>

        {/* Signal */}
        <div className="ois-coin-signal" style={{ color: sigCol }}>
          {loading ? '—' : sigTxt}
        </div>
      </div>
    </div>
  );
}
