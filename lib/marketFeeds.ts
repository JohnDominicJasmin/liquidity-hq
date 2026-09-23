/* The feeds the scheduled job refreshes, and the ONLY place their upstream call
 * is defined (#1404, tracker #1397).
 *
 * One definition per feed, imported by both sides: `app/api/market/ingest`
 * calls `fetchLive()` on a cadence and writes the result to
 * `lhq_market_snapshot`; the page routes read that row and never call an
 * exchange. Keeping the call in one place is the point - two copies of a
 * fan-out definition is how the job and the page start returning different
 * shapes for the same data.
 *
 * WHY THESE TWO AND NOT EVERYTHING. Measured, 10 loads of /dashboard against a
 * local production build, counted at the server:
 *
 *   278  api.binance.com/api/v3/klines
 *    61  api.bybit.com/v5/market/kline
 *    49  api.bybit.com/v5/market/account-ratio      <- here
 *    49  api.bybit.com/v5/market/open-interest      <- here
 *    46  fapi.binance.com/futures/data/globalLongShortAccountRatio
 *    45  fapi.binance.com/futures/data/topLongShortPositionRatio
 *    45  api.binance.com/api/v3/aggTrades
 *
 * The two here are pure fixed-shape fan-outs over a closed symbol list, which
 * is exactly what a snapshot table can hold. **Candles were NOT solved** and
 * are deliberately absent: `app/api/market/klines/route.ts` documents 41
 * distinct call shapes across 12 client files, arbitrary (symbol, interval,
 * limit), limits from 1 to 1500, and two callers that paginate over a time
 * range. A snapshot cannot serve that, and a visitor selecting a pair the job
 * never wrote would get "not available yet" for a chart that works today -
 * a regression dressed as a cache.
 *
 * THE 49 IS PER WINDOW, NOT PER VISITOR. Both feeds already collapse to one
 * fan-out per 120 s cache window, so the 49 above is one fan-out, not 49
 * visitors' worth. What this replaces is that window's floor - paid again by
 * every fresh instance and reset by every deploy - with one job's cadence.
 *
 * COMBINATIONS: exactly the ones the app requests. MarketProvider asks for
 * `account-ratio?period=1h` (line 368) and `open-interest?intervalTime=1h&limit=3`
 * (line 986), and nothing else does. The routes' allowlists are wider than that
 * on purpose, and an unregistered combination still falls through to the live
 * path - refusing it would break a caller to win a statistic.
 */
import { bybitFanout } from '@/lib/bybitFanout';

export type FeedResult = { payload: unknown; source: string; ok: number; total: number; stopped: boolean };

export type MarketFeed = {
  /** Snapshot row key. Carries the parameters, so a second combination is a
   *  second row rather than a schema change. */
  key: string;
  /** Health row name, matching what the page route already reports. */
  health: string;
  fetchLive: () => Promise<FeedResult>;
};

/** The Bybit account long/short ratio, for the one period the app asks for. */
const accountRatio1h: MarketFeed = {
  key: 'bybit:account-ratio:1h',
  health: 'bybit:account-ratio',
  fetchLive: async () => {
    const { data, ok, total, stopped } = await bybitFanout(
      /* A DISTINCT cache key from the page route's own (`bybit:account-ratio:1h`
         there too, but reached through a different TTL). The job wants a fresh
         call every run - that is its whole job - so it passes a TTL of 0 rather
         than inheriting a 120 s window that would make every other run a no-op
         against a cache the page no longer reads. */
      'ingest:bybit:account-ratio:1h',
      0,
      (sym) => `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=1h&limit=1`,
      (body) => {
        const item = (body as { result?: { list?: Array<Record<string, string>> } })?.result?.list?.[0];
        if (!item) return null;
        return {
          longRatio:  parseFloat(item.buyRatio  || '0.5'),
          shortRatio: parseFloat(item.sellRatio || '0.5'),
        };
      },
    );
    return { payload: { data, ok, total, ...(stopped ? { stopped: true } : {}) }, source: 'bybit', ok, total, stopped };
  },
};

/** Bybit open interest, for the one window the app asks for. */
const openInterest1h3: MarketFeed = {
  key: 'bybit:open-interest:1h:3',
  health: 'bybit:open-interest',
  fetchLive: async () => {
    const { data, ok, total, stopped } = await bybitFanout(
      'ingest:bybit:open-interest:1h:3',
      0,
      (sym) => `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=1h&limit=3`,
      /* The upstream list verbatim, newest-first, exactly as the page route
         returns it today - both callers do their own arithmetic over it. */
      (body) => (body as { result?: { list?: unknown[] } })?.result?.list ?? null,
    );
    return { payload: { data, ok, total, ...(stopped ? { stopped: true } : {}) }, source: 'bybit', ok, total, stopped };
  },
};

export const MARKET_FEEDS: MarketFeed[] = [accountRatio1h, openInterest1h3];

/** The key a page route looks up for a given set of parameters, or null when
 *  that combination is not one the job refreshes - in which case the route
 *  serves it live, as it always has. */
export function feedKeyFor(feed: 'account-ratio' | 'open-interest', params: Record<string, string>): string | null {
  if (feed === 'account-ratio' && params.period === '1h') return accountRatio1h.key;
  if (feed === 'open-interest' && params.intervalTime === '1h' && params.limit === '3') return openInterest1h3.key;
  return null;
}
