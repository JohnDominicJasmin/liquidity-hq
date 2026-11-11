'use client';
import { useState, useEffect, useRef } from 'react';
import { CoinId } from './marketStore.ts';
import { COIN_UNIVERSE } from './coinUniverse.generated.ts';
import { oiHistChange } from './oiTrend1h.ts';

/* ── Endpoints ──
 *
 * EVERY COIN WITH A PERP, not the eight that used to be listed here (owner report, 2026-11-11).
 * These two maps held 7 Binance ids and 1 Bybit id, so the 1h open-interest card read "Unavailable"
 * for about 42 of the 50 RENDERED coins, never mind the universe - and "Unavailable" on a healthy
 * venue reads as broken rather than as unmapped.
 *
 * Measured on production before widening: `/api/proxy?type=oi-hist&symbol=CYBERUSDT` returns real
 * `sumOpenInterest` AND `sumOpenInterestValue`, and the Bybit equivalent answers `retCode: 0` for
 * the same coin. The proxy never gated these by symbol - only this file did.
 *
 * BINANCE FIRST, BYBIT FOR WHAT BINANCE DOES NOT LIST, which is the order the fetch below already
 * used for the hand-written maps. Only Binance carries `sumOpenInterestValue`, so a Bybit-only coin
 * gets a percentage change and no USD notional - see the `oiUsd` note in that branch. */

const BINANCE_OI: Partial<Record<CoinId, string>> = Object.fromEntries(
  COIN_UNIVERSE.filter(r => r.binance).map(r => [r.id, r.binance as string]),
);
const BYBIT_OI: Partial<Record<CoinId, string>> = Object.fromEntries(
  COIN_UNIVERSE.filter(r => r.bybit).map(r => [r.id, r.bybit as string]),
);

export interface OI1hData {
  /**
   * THE COIN THIS SNAPSHOT IS FOR, set inside this hook from the coin it actually fetched.
   *
   * A consumer cannot derive this for itself. For one render after a coin change the component
   * already holds the NEW coin while this hook still returns the OLD snapshot, so a consumer that
   * stamps its own `selectedCoin` writes `{ coin: new, pct: old }` — which is worse than no stamp,
   * because it looks like a checked value and passes a coin guard (#1651, QA on #2120).
   */
  coin:    CoinId;
  oiUsd:   number | null;
  pct:     number | null;
  /** The price change over the SAME hour as `pct`, implied by the samples (USD value / contracts). null where the source has no USD value (the Bybit
   *  fallback, Bybit-only coins): unknown, never "flat". Lets the card's label and its number describe one window (#1613, lib/oiTrend1h.ts). */
  pricePct: number | null;
  loading: boolean;
  /**
   * WHY `pct` IS ABSENT, when it is. Three different things used to arrive as the same `pct: null`
   * and the card printed one word for all of them (#1651, QA's finding):
   *
   *   - `'ok'`            - `pct` is a real number.
   *   - `'short-window'`  - the exchange answered, but with fewer than two samples an hour apart,
   *                         or a pair we cannot divide (an older sample of zero). **Nothing is
   *                         wrong**; there is not enough history yet, which is normal for a newly
   *                         listed coin and for the first minutes after a cache flush.
   *   - `'failed'`        - we could not get an answer: the request errored, the venue returned a
   *                         non-OK status, or this coin has no open-interest symbol mapped.
   *
   * The distinction is the whole point: "we are still collecting" and "we could not reach the
   * exchange" are different facts about the market, and a reader who is told the second when the
   * first is true will go looking for an outage that is not there.
   */
  reason: 'ok' | 'short-window' | 'failed';
}

export function useOI1h(coin: CoinId): OI1hData {
  const [data, setData]   = useState<OI1hData>({ coin, oiUsd: null, pct: null, pricePct: null, loading: true, reason: 'failed' });
  const mountedRef        = useRef(true);
  const fetchingRef       = useRef(false);

  useEffect(() => {
    mountedRef.current  = true;
    fetchingRef.current = false;
    setData({ coin, oiUsd: null, pct: null, pricePct: null, loading: true, reason: 'failed' });

    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const binSym = BINANCE_OI[coin];
        const bbtSym = BYBIT_OI[coin];
        let result: Omit<OI1hData, 'loading'> = { coin, oiUsd: null, pct: null, pricePct: null, reason: 'failed' };

        if (binSym) {
          /* ITS OWN TRY, so a THROWN request reaches the Bybit fallback below rather than the
             outer catch. A DNS failure, an abort and a connection reset are the same fact as a
             429 - we did not get an answer from this venue - and only the status code was
             falling through before. */
          try {
          const r = await fetch(
            `/api/proxy?type=oi-hist&symbol=${binSym}&period=5m&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as Array<{ sumOpenInterest: string; sumOpenInterestValue?: string; timestamp?: number }>;
            /* THE VENUE ANSWERED, so from here on an absent `pct` is a WINDOW problem rather than a
               reachability one - too few samples, or samples that do not span the hour. Set before
               the length check so the `< 2` case is covered by it too; the branches below only
               narrow it to 'ok'. */
            result = { ...result, reason: 'short-window' };
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
                coin,
                oiUsd: Number.isFinite(rawUsd) ? rawUsd : null,
                pct:   change?.oiPct ?? null,
                // Same two samples, so the same hour: price = USD value / contracts at each end (#1613). The Telegram Distribution alert reads
                // its OI trend through the same helper (#1651).
                pricePct: change?.pricePct ?? null,
                /* `oiHistChange` returns null when the 13 samples do not SPAN the hour (#1696), which
                   is the gapped-window case QA asked to name - still 'short-window', not a failure. */
                reason: change?.oiPct == null ? 'short-window' : 'ok',
              };
            }
          }
          } catch { /* leaves result.reason === "failed", which the fallback below reads */ }
        }

        /* VENUE FALLBACK (#1651). This was `else if`, so a coin WITH a Binance symbol could never
           reach Bybit: a 429 from Binance ended as `reason: "failed"` and the card said we could
           not reach the exchange, while Bybit on the same host was answering 200. Measured on qa.

           Gated on `failed` rather than on the status, so it covers every way of getting no answer:
           a non-OK status, an unparseable body, and now a thrown request. A Binance answer that was
           merely SHORT ("short-window") does NOT fall through - the venue answered, and that is a
           different fact from being unreachable. PM scoped this to no-answer, and widening it to
           short windows would be a second decision rather than this one. */
        if (result.reason === 'failed' && bbtSym) {
          const r = await fetch(
            `/api/proxy?type=open-interest-1&symbol=${bbtSym}&intervalTime=5min&limit=13`,
            { cache: 'no-store' }
          );
          if (r.ok) {
            const d = await r.json() as { result?: { list?: Array<{ openInterest: string }> } };
            const list = d.result?.list ?? [];
            result = { ...result, reason: 'short-window' };   // same reasoning as the Binance branch above
            if (list.length >= 2) {
              const newest = parseFloat(list[0].openInterest);
              const oldest = parseFloat(list[list.length - 1].openInterest);
              /* NO USD NOTIONAL FROM BYBIT, so `oiUsd` is null rather than a contract count wearing
                 a dollar sign. This branch used to pass `newest` straight through - which is
                 `openInterest`, a quantity of contracts - into a field the card renders as USD, so
                 HYPE's figure was never the dollar value it looked like. The Binance branch above
                 already states the rule (#1238): Bybit's endpoint has no USD field, fabricating one
                 was rejected, and absent beats a wrong number. Widening these maps spread the
                 inconsistency to every Bybit-only coin, so it is fixed rather than carried. */

              result = { coin, oiUsd: null, pct: oldest > 0 ? (newest - oldest) / oldest * 100 : null, pricePct: null, reason: oldest > 0 ? 'ok' : 'short-window' };
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
