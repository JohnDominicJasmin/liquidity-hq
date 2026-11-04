/* ONE COIN'S BYBIT LONG/SHORT ACCOUNT RATIO, RESOLVED THE SAME WAY THE PAGE RESOLVES IT.
 *
 * #1631 item 5, step 2 left `longShortRatio` as the one context field the server did not source.
 * This is that follow-up. The reason it was deferred is the reason this file is shaped as it is, so
 * it is worth restating: the obvious server-side source was `lsr.bnLongRatio` from
 * `marketSnapshotData`, which is the **Binance global** ratio over **5m**, while the formatter's
 * sentence and its thresholds were written for the **Bybit account** ratio over **1h**
 * (`lib/marketStore.ts:35-37`). Same slot, different quantity. Printing one as the other changes
 * the number with nothing failing.
 *
 * ── THE RESOLUTION ORDER IS THE WHOLE POINT, AND IT IS NOT JUST THE FAN-OUT ──────────────────────
 *
 * `app/api/market/account-ratio/route.ts` does not simply call Bybit. It resolves:
 *
 *   1. the SNAPSHOT ROW the scheduled job wrote (`feedFor` + `resolveFeedSnapshot`), when there is
 *      one and it is not too old - making no exchange call at all; then
 *   2. the LIVE fan-out of ~50 symbols, cached 120 s.
 *
 * The browser gets whichever of those the route picked. **So sourcing only the live path would
 * diverge from the page exactly as `bnLongRatio` would** - not by exchange, but by reading a
 * fresh fan-out while the page read an hour-old stored bucket. A near-miss worth naming: the live
 * path is the one that looks like "the source", and it is the one the page usually does NOT use.
 *
 * This file therefore mirrors the order rather than picking a layer.
 *
 * ── STALENESS IS PASSED THROUGH, NOT RE-DECIDED ─────────────────────────────────────────────────
 *
 * `resolveFeedSnapshot` already decides whether a row is servable, and the route serves what it
 * returns while labelling `stale`. `MarketProvider` ignores that label, so **the page already shows
 * a stale ratio as current**. Using the same row keeps parity; re-deciding here would mean the
 * prompt and the panel disagree, which is worse than both being equally stale. The flag is returned
 * so the caller can log it - the honest addition is visibility, not a second policy.
 */
import { bybitFanout } from './bybitFanout.ts';
import { feedFor } from './marketFeeds.ts';
import { resolveFeedSnapshot } from './marketSnapshot.ts';
import { BYBIT_SYMS } from './marketStore.ts';
import {
  ACCOUNT_RATIO_DEFAULT_PERIOD,
  accountRatioUrl,
  pickAccountRatio,
  type AccountRatioEntry,
} from './accountRatioParse.ts';

export type AccountRatioLookup =
  | {
      ok: true;
      /** `null` when the symbol is absent from the reading - not fetched, never "zero". */
      entry: AccountRatioEntry | null;
      from: 'snapshot' | 'live';
      /** How old the market data is, when the snapshot path answered. */
      dataAgeMs: number | null;
      stale: boolean;
    }
  | { ok: false; reason: unknown };

/** The fan-out keys by Bybit SYMBOL, and the caller holds a coin id - `MarketProvider.tsx:363`
 *  does this same mapping. Getting it wrong would miss every coin and read as an empty upstream. */
const symbolFor = (coin: string): string | undefined =>
  (BYBIT_SYMS as Record<string, string | undefined>)[coin];

/**
 * @param coin lowercase tracked coin id.
 * @param period defaults to the only period the app reads. A caller asking for another one gets a
 *   different cache entry and a different fan-out, which is why the page has an allowlist.
 */
export async function accountRatioFor(
  coin: string,
  period: string = ACCOUNT_RATIO_DEFAULT_PERIOD,
): Promise<AccountRatioLookup> {
  const sym = symbolFor(coin);
  /* No Bybit symbol means this coin has no such reading at all - `entry: null`, not a failure. The
     caller degrades that one field to '-' rather than refusing the whole request. */
  if (!sym) return { ok: true, entry: null, from: 'live', dataAgeMs: null, stale: false };

  /* 1. THE STORED ROW FIRST, exactly as the route does, and with no exchange call when it hits. */
  const feed = feedFor('account-ratio', { period });
  if (feed) {
    const snap = await resolveFeedSnapshot(feed, 'arena-account-ratio');
    if (snap) {
      const data = (snap.body as { data?: Record<string, AccountRatioEntry | null> } | undefined)?.data;
      return {
        ok: true,
        entry: data?.[sym] ?? null,
        from: 'snapshot',
        dataAgeMs: snap.dataAgeMs,
        stale: snap.stale,
      };
    }
  }

  /* 2. THE LIVE FAN-OUT, on the SAME cache key and TTL the page route uses, so an Arena read and a
        page poll share one entry instead of each paying for 50 upstream calls. The ingest job
        deliberately uses a different key with TTL 0 - it wants a fresh call every run - and
        borrowing that key here would turn every other ingest run into a no-op. */
  try {
    const { data } = await bybitFanout(
      `bybit:account-ratio:${period}`,
      120_000,
      (s) => accountRatioUrl(s, period),
      pickAccountRatio,
    );
    return {
      ok: true,
      entry: (data[sym] as AccountRatioEntry | undefined) ?? null,
      from: 'live',
      dataAgeMs: null,
      stale: false,
    };
  } catch (e) {
    /* `bybitFanout` throws on an empty run rather than returning one - #228's rule, an empty result
       must never look like a successful one. The caller treats this as one field unavailable, not
       as an outage: the price and the candles came from a different provider entirely. */
    return { ok: false, reason: e };
  }
}
