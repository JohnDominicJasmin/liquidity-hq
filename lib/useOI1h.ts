'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId } from './marketStore.ts';
import { oiHistChange } from './oiTrend1h.ts';

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
  /** The price change over the SAME hour as `pct`, implied by the samples (USD value / contracts). null where the source has no USD value (the Bybit
   *  fallback, Bybit-only coins): unknown, never "flat". Lets the card's label and its number describe one window (#1613, lib/oiTrend1h.ts). */
  pricePct: number | null;
  loading: boolean;
}

export function useOI1h(coin: CoinId): OI1hData {
  const [data, setData]   = useState<OI1hData>({ oiUsd: null, pct: null, pricePct: null, loading: true });
  const mountedRef        = useRef(true);
  const fetchingRef       = useRef(false);

  useEffect(() => {
    mountedRef.current  = true;
    fetchingRef.current = false;
    setData({ oiUsd: null, pct: null, pricePct: null, loading: true });

    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const binSym = BINANCE_OI[coin];
        const bbtSym = BYBIT_OI[coin];
        let result: Omit<OI1hData, 'loading'> = { oiUsd: null, pct: null, pricePct: null };

        if (binSym) {
          const r = await fetch(
            `/api/proxy?type=oi-hist&symbol=${binSym}&period=5m&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as Array<{ sumOpenInterest: string; sumOpenInterestValue?: string; timestamp?: number }>;
            if (d.length >= 2) {
              /* #1696: the 13 samples must SPAN the hour they claim, not merely number 13 - Binance can skip points, and the card would
                 then label a three-hour move "1h" (QA's LOW finding). One poll of tolerance (5 minutes) either way. */
              const change = oiHistChange(d, { ms: 60 * 60_000, toleranceMs: 5 * 60_000 });
              // #1238: sumOpenInterestValue is absent, not just unparseable,
              // when this came back via the proxy's Bybit fallback - Bybit's
              // open-interest endpoint has no USD-notional field to source
              // it from, and fabricating one (e.g. openInterest * a separate
              // ticker fetch's markPrice) was rejected as more machinery and
              // more assumptions than one display number is worth. `pct` is
              // unaffected either way - it's computed from sumOpenInterest,
              // which the fallback DOES populate. Absent beats a NaN
              // rendering as the literal string "NaN" in the UI.
              const rawUsd = parseFloat(d[d.length - 1].sumOpenInterestValue ?? '');
              result = {
                oiUsd: Number.isFinite(rawUsd) ? rawUsd : null,
                pct:   change?.oiPct ?? null,
                // Same two samples, so the same hour: price = USD value / contracts at each end (#1613). The Telegram Distribution alert reads
                // its OI trend through the same helper (#1651).
                pricePct: change?.pricePct ?? null,
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
              result = { oiUsd: newest, pct: oldest > 0 ? (newest - oldest) / oldest * 100 : null, pricePct: null };
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
