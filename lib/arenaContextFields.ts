/* THE ARENA CONTEXT FIELDS THE SERVER CAN OWN, FORMATTED IN ONE PLACE SO TWO CALLERS CANNOT DIVERGE.
 *
 * #1631 item 5, step 2. `app/api/grok/route.ts` assembles the prompt server-side (that moved in
 * `b1ddff31`) but every NUMBER in it still arrives from the browser. The fix is for the server to
 * fetch these itself and overwrite them before the prompt is built.
 *
 * WHY THIS FILE EXISTS RATHER THAN A SECOND COPY OF THE FORMATTING. Each field below is not a
 * number - it is a sentence with interpretive text baked in: "68.4 (Overbought)", "ABOVE MA20
 * (+1.23% - bullish)", "price BELOW POC (bearish)". Writing a server-side version of thirteen of
 * those is thirteen chances to differ by a space or a threshold, and **a prompt that differs by a
 * space produces a different answer with nothing failing**. There is no test that catches a changed
 * adjective.
 *
 * So the formatting is not DUPLICATED and then asserted equal - it is SHARED, and divergence is
 * impossible rather than checked. One function, two callers: the Arena page passes the row from the
 * market store, the server passes a row it built from `lib/marketSnapshotData.ts` and
 * `lib/marketRsi.ts`. Same input shape, same output, by construction.
 *
 * MOVED VERBATIM FROM `app/(main)/arena/page.tsx`. Every expression here is the one that was inline
 * in the context builder, unchanged - including the `'-'` fallbacks, the threshold numbers and the
 * exact wording. This file introduces no new behaviour; it only gives the server somewhere to call.
 *
 * NOTE ON THE FALLBACK, since #1888 changed the neighbouring vocabulary. These fields fall back to
 * `'-'`, not to `UNKNOWN_NUMBER`. That is deliberate for now: `'-'` is what the browser has always
 * sent for an absent field, and changing it here would alter the prompt in the same commit that
 * moves the code - two changes, one diff, and no way to tell which one moved an answer. The
 * marker inconsistency between `'-'` here and `N/A` from `priceText` is real and tracked on #1651;
 * it is not this file's to fix quietly.
 */
import { priceText } from './numberFormat.ts';
import type { CoinData } from './marketStore.ts';
import type { GrokContext } from './grok.ts';

/**
 * The context fields the server sources itself. **Everything NOT in this list is still the
 * browser's**, and that distinction is the whole point of having the list.
 *
 * It is an exported constant rather than a comment because a comment does not survive: the route
 * spreads exactly these keys over the client's object, so when field 14 moves the list moves with
 * it, and anything asserting against the list fails loudly instead of quietly covering less.
 */
export const ARENA_NUMBER_FIELDS = [
  'price', 'change24h', 'ma20', 'priceVsMA', 'volRatio',
  'rsi14', 'rsi1h', 'rsi4h', 'rsiDaily',
  'longShortRatio', 'vwap', 'takerRatio', 'pocLine',
] as const;

export type ArenaNumberField = (typeof ARENA_NUMBER_FIELDS)[number];

/**
 * What the ROUTE actually overwrites, which is twelve of the thirteen above.
 *
 * TWO LISTS RATHER THAN ONE, BECAUSE "THE FORMATTER CAN PRODUCE IT" AND "THE SERVER CAN SOURCE IT"
 * ARE DIFFERENT CLAIMS, and collapsing them is how the one exception below would have gone unnoticed.
 *
 * `longShortRatio` IS DELIBERATELY ABSENT, and it is the only one. The formatter reads
 * `coin.longRatio` / `coin.shortRatio`, which `lib/marketStore.ts:35-36` documents as the **Bybit
 * account ratio over 1h**, fetched by `app/api/market/account-ratio/route.ts`. The server-side
 * snapshot carries `lsr.bnLongRatio` instead - `marketStore.ts:37`, the **Binance global account
 * ratio over 5m**. Different exchange, different window.
 *
 * So feeding the snapshot's value into that slot would print a Binance 5m number in a sentence whose
 * wording and thresholds were written for a Bybit 1h one. **The string would change value and
 * nothing would fail** - the exact hazard this module's header says sharing the formatter prevents,
 * arriving through the INPUT rather than through a second copy of the formatting. Sharing the
 * formatter makes divergence impossible only while both callers feed it the same quantity.
 *
 * FOLLOW-UP, not a permanent carve-out: `account-ratio` is a thin wrapper over `lib/bybitFanout.ts`
 * and `lib/ratioPair.ts`, so the 1h Bybit ratio IS reachable server-side. Sourcing it is a separate
 * change with its own parity check, and until then this field stays the browser's.
 */
export const SERVER_SOURCED_FIELDS = [
  'price', 'change24h', 'ma20', 'priceVsMA', 'volRatio',
  'rsi14', 'rsi1h', 'rsi4h', 'rsiDaily',
  'vwap', 'takerRatio', 'pocLine',
] as const;

export type ServerSourcedField = (typeof SERVER_SOURCED_FIELDS)[number];

/* The overwrite list must stay a SUBSET of what the formatter produces. Without this, dropping a
   field from ARENA_NUMBER_FIELDS while leaving it here would spread an undefined over a real
   context value - a field silently blanked rather than loudly missing. */
type _OverwriteIsSubset = ServerSourcedField extends ArenaNumberField ? true : never;
const _subsetHolds: _OverwriteIsSubset = true;
void _subsetHolds;

/* Every name above must be a real GrokContext key. A typo would otherwise add a field the prompt
   builder ignores, and the overwrite would silently cover one field fewer than the list claims. */
type IsContextKey<T extends keyof GrokContext> = T;
const _fieldsAreReal: IsContextKey<ArenaNumberField> = 'price';
void _fieldsAreReal;

/**
 * Format the thirteen fields from a market-store row.
 *
 * Takes a `Partial<CoinData>` because the server builds its row from two feeds and will not always
 * have every key - and because every expression below already guards with `!= null`, a partial row
 * degrades to `'-'` per field exactly as a missing value from the store does.
 */
export function arenaNumberFields(
  coin: Partial<CoinData> | undefined,
): Pick<GrokContext, ArenaNumberField> {
  /* Multi-TF RSI. Note `toFixed(0)` here against `toFixed(1)` for rsi14 below - that difference is
     in the original and is kept; the 14-period reading is quoted more precisely than the
     per-timeframe ones. */
  const fmt = (v: number | null | undefined) => v != null
    ? v.toFixed(0) + (v >= 70 ? ' (Overbought)' : v <= 30 ? ' (Oversold)' : ' (Neutral)')
    : '-';

  const takerBuy = coin?.takerBuyRatio;

  return {
    price: coin?.price ? priceText(coin.price) : '-',
    change24h: coin?.change != null ? (coin.change >= 0 ? '+' : '') + coin.change.toFixed(2) + '%' : '-',

    rsi14: coin?.rsi14 != null
      ? coin.rsi14.toFixed(1) + (coin.rsi14 >= 70 ? ' (Overbought)' : coin.rsi14 <= 30 ? ' (Oversold)' : ' (Neutral)')
      : '-',
    ma20: coin?.ma20 != null ? priceText(coin.ma20) : '-',
    priceVsMA: coin?.price && coin?.ma20
      ? coin.price > coin.ma20
        ? 'ABOVE MA20 (+' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% - bullish)'
        : 'BELOW MA20 (' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% - bearish)'
      : '-',
    volRatio: coin?.volRatio != null
      ? coin.volRatio.toFixed(2) + 'x' + (coin.volRatio >= 1.5 ? ' (spike)' : coin.volRatio <= 0.6 ? ' (dry)' : ' (normal)')
      : '-',
    longShortRatio: coin?.longRatio != null && coin?.shortRatio != null
      ? 'Long ' + (coin.longRatio * 100).toFixed(1) + '% / Short ' + (coin.shortRatio * 100).toFixed(1) + '%'
        + (coin.longRatio > 0.6 ? ' (overleveraged longs)' : coin.shortRatio > 0.6 ? ' (overleveraged shorts)' : ' (balanced)')
      : '-',

    rsi1h: fmt(coin?.rsi1h),
    rsi4h: fmt(coin?.rsi4h),
    rsiDaily: fmt(coin?.rsiDaily),

    pocLine: coin?.poc != null
      ? priceText(coin.poc)
        + (coin.vah != null ? ' | VAH ' + priceText(coin.vah) : '')
        + (coin.val != null ? ' | VAL ' + priceText(coin.val) : '')
        + (coin.price && coin.poc ? (coin.price > coin.poc ? ' - price ABOVE POC (bullish)' : ' - price BELOW POC (bearish)') : '')
      : '-',

    takerRatio: takerBuy != null
      ? `Buy ${Math.round(takerBuy * 100)}% / Sell ${Math.round((1 - takerBuy) * 100)}%`
        + (takerBuy >= 0.65 ? ' - aggressive buyers hitting asks (BULLISH)'
        :  takerBuy >= 0.55 ? ' - mild buy pressure'
        :  takerBuy <= 0.35 ? ' - aggressive sellers hitting bids (BEARISH)'
        :  takerBuy <= 0.45 ? ' - mild sell pressure'
        :                     ' - balanced flow')
      : '-',

    vwap: coin?.vwap != null
      ? priceText(coin.vwap)
        + (coin.price
          ? (coin.price > coin.vwap
              ? ' - price ABOVE VWAP (bullish, paying up)'
              : ' - price BELOW VWAP (bearish, distributing)')
          : '')
      : '-',
  };
}
