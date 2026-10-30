/* The coins this app serves, DERIVED from what the exchanges trade (#1263, #1600).
 *
 * This file used to hold five hand-written maps - COINS, BINANCE_SYMS, BYBIT_SYMS, COIN_DEC,
 * COIN_LABELS - that had to agree with each other, 50 entries each. Adding a coin meant five
 * edits and getting one wrong was silent. The owner asked for "as many coins as possible" on
 * 2026-10-20 and again on 2026-10-30; a list that has to be typed is a list that stays at 50.
 *
 * Now `scripts/generate-coins.mjs` writes `coinUniverse.generated.ts` from both exchanges and
 * everything below is derived from it. Adding a coin is a regeneration, not an edit.
 *
 * THE SELECTION RULE is the failover guarantee expressed as a list: an instrument qualifies
 * when BOTH Bybit and Binance trade it as a USDT perpetual. Bybit is the default source and
 * Binance the failover (lib/klinesFailover.ts), so a single-venue coin has no second source.
 * Two exceptions are kept deliberately and marked `oneVenue` - see the generator's header.
 *
 * WHAT THE HAND TABLE GOT WRONG, found by generating it: `pepe` and `bonk` were recorded as
 * Bybit-only, and Binance lists `1000PEPEUSDT` and `1000BONKUSDT` too. They have had no
 * failover for as long as that comment has been there, for no reason.
 */
import { COIN_UNIVERSE, type CoinRow } from './coinUniverse.generated.ts';

/* A coin id is now any string the generated universe contains, not a closed union.
 *
 * It was a hand-written union of 50 literals, and that is what made the list unextendable:
 * a generated list cannot produce a compile-time union, and `Record<CoinId, …>` demanded an
 * entry per literal. Measured before changing it - of 21 `Record<CoinId, …>` uses across the
 * app, 19 are `Partial<…>` and need no change at all, and the only two total ones were
 * COIN_DEC and COIN_LABELS, both in this file. So widening costs almost nothing elsewhere. */
export type CoinId = string;

const BY_ID = new Map<string, CoinRow>(COIN_UNIVERSE.map(r => [r.id, r]));

/** Every instrument, ranked by 24h turnover on the thinner of its two venues. */
export const COINS: CoinId[] = COIN_UNIVERSE.map(r => r.id);

/* HOW MANY COINS THE ALERT CRON SCANS, and why it is not simply `COINS`.
 *
 * `app/api/telegram/alert/route.ts` fetches 300 klines PER COIN on every run - `checkRSI` alone
 * is `runBatched(COINS.map(...))`. That cost tracked the length of the list, so growing the list
 * from 50 to 463 would have multiplied the cron's exchange calls by nine without anyone choosing
 * it. **The breadth of the scan and the breadth of the product are different questions, and
 * before this they were the same variable.**
 *
 * So the product gets every instrument - selection, charts, Pro access, the heatmap - and the
 * SCAN stays at the number it has been running at. Nothing about the cron's cost changes with
 * this release.
 *
 * THE RIGHT ANSWER IS SMALLER THAN THIS, and it is the next change rather than this one: the
 * cron should scan the union of coins at least one recipient has NOT muted. Mute keys are
 * already `coin:<id>` and today's two recipients have muted 46 and 47 coins each, so the real
 * working set is about four. That would make the cron cheaper than it is now, at any list
 * length. It needs `mutedByUser` threaded into the check functions, which is a refactor of a
 * 2,400-line route and does not belong in the same change as the list.
 *
 * Sliced off the front because the generated universe is sorted by liquidity on the thinner
 * venue, so this is "the most tradable N" rather than an arbitrary N. */
export const SCAN_LIMIT = 50;
export const SCANNED_COINS: CoinId[] = COINS.slice(0, SCAN_LIMIT);

/** The row behind a coin, or undefined for an id this build does not serve. */
export function coinRow(coin: string): CoinRow | undefined {
  return BY_ID.get(coin);
}

/** True when only one exchange lists it, so a failover read is not available. */
export function isSingleVenue(coin: string): boolean {
  return BY_ID.get(coin)?.oneVenue ?? false;
}

export const BINANCE_SYMS: Record<string, string> = Object.fromEntries(
  COIN_UNIVERSE.filter(r => r.binance).map(r => [r.id, r.binance as string]),
);

// Bybit linear perp symbols - includes the 1000x meme listings and the synthetics.
export const BYBIT_SYMS: Record<string, string> = Object.fromEntries(
  COIN_UNIVERSE.filter(r => r.bybit).map(r => [r.id, r.bybit as string]),
);

/* Reverse of BINANCE_SYMS - given a Binance symbol, which coin it is. Shared across every
 * #1077 server-side failover route that fans out over BINANCE_SYMS and needs that coin's
 * Bybit equivalent, or needs to discover there isn't one.
 * app/api/market/klines/route.ts still keeps its own local copy rather than importing this -
 * out of scope here, not overlooked. */
export const BINANCE_SYM_TO_COIN: Record<string, string> = Object.fromEntries(
  Object.entries(BINANCE_SYMS).map(([coin, sym]) => [sym, coin]),
);

/* Decimal places for display, from each exchange's own tick size rather than a hand table.
 *
 * 44 of the previous 50 hand-written values come out identical. Six differ because the
 * exchange disagrees with what was typed, and the exchange is the authority on its own tick:
 *
 *     btc  2 -> 1     sol  3 -> 2     near 4 -> 3
 *     dot  3 -> 4     dydx 4 -> 5     gmt  5 -> 6
 *
 * Three of those show MORE precision than before and three show less. The three that show
 * less are cases where the hand table displayed a digit the venue does not quote. */
export const COIN_DEC: Record<string, number> = Object.fromEntries(
  COIN_UNIVERSE.map(r => [r.id, r.dec]),
);

/** Display label. The ticker is the label for every instrument, so this is derived rather
 *  than listed - a generated coin cannot arrive without one. */
export const COIN_LABELS: Record<string, string> = Object.fromEntries(
  COIN_UNIVERSE.map(r => [r.id, r.id.toUpperCase()]),
);

/* Bybit quotes the low-unit-price meme perps per 1000 tokens - 1000PEPEUSDT, 1000BONKUSDT -
   so ANY price read from those symbols is 1000x the per-token price every other part of this
   app uses. Multiply by this factor to convert.

   This existed as an inline `sym.startsWith('1000') ? 0.001 : 1` in two places and was missed
   in a third: app/api/alert-outcomes/resolve recorded price_24h straight from Bybit while
   price_at_fire was already normalised, giving PEPE and BONK outcomes of ±100,000%. That
   dragged the Alert Track Record's average 24h move to -126% when the real median across
   6,201 fires is +0.28%.

   The factor is now DERIVED from the symbol the exchange returned and carried in the generated
   row, so a new 1000x listing cannot arrive without it. The string test is kept as the
   fallback for an id the universe does not know.

   Any new code reading a price, kline or level from BYBIT_SYMS must apply this. The failure is
   silent and only shows up on the 1000x coins. */
export function bybitPriceFactor(coin: string): number {
  const row = BY_ID.get(coin);
  if (row) return row.mult;
  return BYBIT_SYMS[coin]?.startsWith('1000') ? 0.001 : 1;
}

/** Same conversion when only the symbol is in hand, not the coin id. */
export function bybitSymbolPriceFactor(symbol: string): number {
  const m = /^(\d+)/.exec(symbol);
  return m ? 1 / Number(m[1]) : 1;
}

/* The symbol the CHART shows, which is not always the symbol we fetch.
 *
 * klinecharts' y-axis collapses at very small values, so the 1000x meme perps are charted on
 * the exchange's own 1000x series and the label says so. Everything else in the app - ticker,
 * alerts, outcome tracking, EMA Signal card, Market Structure card, Confluence Score - is
 * per-token.
 *
 * Nothing leaks out of the chart at this scale: its two internal consumers of the last close
 * are a pixel conversion and a percentage distance to S/R, both scale-invariant. Revisit if
 * klinecharts fixes small-value axes - the fix is to delete this and re-apply
 * bybitSymbolPriceFactor in the chart's fetches. */
export function chartDisplaySymbol(coin: string): string {
  const prefix = BYBIT_SYMS[coin]?.startsWith('1000') ? '1000' : '';
  return `${prefix}${coin.toUpperCase()}/USDT`;
}
