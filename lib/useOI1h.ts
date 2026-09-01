'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId } from './marketStore';

/* ── Endpoints ── */
const BINANCE_OI: Partial<Record<CoinId, string>> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
const BYBIT_OI: Partial<Record<CoinId, string>> = {
  hype: 'HYPEUSDT',
};

export interface OI1hData {
  oiUsd:   number | null;
  pct:     number | null;
  loading: boolean;
}

export function useOI1h(coin: CoinId): OI1hData {
  const [data, setData]   = useState<OI1hData>({ oiUsd: null, pct: null, loading: true });
  const mountedRef        = useRef(true);
  const fetchingRef       = useRef(false);

  useEffect(() => {
    mountedRef.current  = true;
    fetchingRef.current = false;
    setData({ oiUsd: null, pct: null, loading: true });

    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const binSym = BINANCE_OI[coin];
        const bbtSym = BYBIT_OI[coin];
        let result: Omit<OI1hData, 'loading'> = { oiUsd: null, pct: null };

        if (binSym) {
          const r = await fetch(
            `/api/proxy?type=oi-hist&symbol=${binSym}&period=5m&limit=13`,
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
            `/api/proxy?type=open-interest-1&symbol=${bbtSym}&intervalTime=5min&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as { result?: { list?: Array<{ openInterest: string }> } };
            const list = d.result?.list ?? [];
            if (list.length >= 2) {
              const newest = parseFloat(list[0].openInterest);
              const oldest = parseFloat(list[list.length - 1].openInterest);
              result = { oiUsd: newest, pct: oldest > 0 ? (newest - oldest) / oldest * 100 : null };
            }
          }
        }

        if (mountedRef.current) setData({ ...result, loading: false });
      } catch {
        if (mountedRef.current) setData(prev => ({ ...prev, loading: false }));
      } finally {
        fetchingRef.current = false;
      }
    };

    load();
    const iv     = setInterval(load, 60_000);
    const onVis  = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [coin]);

  return data;
}

/* ── Derive signal text from pct + oiTrend ── */
const OI_TREND_TXT: Record<string, string> = {
  strong_up:   'New longs - real trend ▲',
  strong_down: 'New shorts - real dump ▼',
  weak_up:     'Short covering - weak pump',
  weak_down:   'Long exits - no panic',
};

export function oi1hSignal(pct: number | null, oiTrend?: string | null): { txt: string; col: string } {
  if (pct == null) return { txt: '-', col: 'var(--txt3)' };
  const isPos   = pct > 0;
  const isSpike = Math.abs(pct) >= 10;
  const trendTxt = oiTrend ? OI_TREND_TXT[oiTrend] : null;

  const txt = isSpike
    ? (trendTxt ?? (isPos ? 'OI spike - rising' : 'OI spike - unwinding'))
    : trendTxt ?? (Math.abs(pct) < 2 ? 'Stable' : isPos ? 'Rising' : 'Unwinding');

  // --green/--red, not the -soft variants (#546 C9): --green-soft/--red-soft
  // are undeclared in terminal's 16-token palette and fall through to the
  // current design's Tailwind-derived root values there.
  const col = isSpike && isPos ? 'var(--green)'
    : isSpike && !isPos        ? 'var(--red)'
    : isPos                    ? 'var(--green)'
    : pct < 0                  ? 'var(--red)'
    : 'var(--txt3)';

  return { txt, col };
}
