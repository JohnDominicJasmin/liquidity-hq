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

/** EVERY instrument the exchanges trade and both venues cover - 463 of them, opt-in.
 *
 * Nothing renders this by default. It is here for the surfaces that are SUPPOSED to offer the
 * whole market, and each of those is a visual decision the owner signs off on one at a time.
 * Import it deliberately; do not reach for it because it is the bigger number. */
export const UNIVERSE_COINS: CoinId[] = COIN_UNIVERSE.map(r => r.id);

/* WHAT THE APP RENDERS, and why this is an EDITORIAL list rather than the top 50 of the
 * universe. This was `COIN_UNIVERSE.map(...)` - all 463 - and that was wrong in two ways that
 * only showed up when the landing page was measured rather than reasoned about.
 *
 * ONE: 76 references to `COINS` across 23 files all silently became 463. The landing ticker
 * rendered 448 symbols instead of 50 (+163 KB of markup on `/`, measured by the landing gate).
 * `CorrelationTerminal` builds an N-by-N matrix and fetches klines per coin: 463 requests and
 * 214,369 cells. `BriefingTerminal` puts a row per coin into an AI prompt that has a
 * 64,000-character cap. None of that was chosen; it followed from one list changing length.
 *
 * TWO, and worse because it is invisible: slicing the front of a universe sorted by turnover
 * does NOT give back the 50 coins this app has been running. Measured against `origin/dev` -
 * 18 coins leave and 18 arrive. Leaving: atom bonk dydx etc fil gmt gmx jup ldo mana pyth
 * render rune sand sei spx stx wif. Arriving: birb fartcoin hbar lit lsk parti pengu q qnt soph
 * strk trump useless xaut xmr xpl zec zro. **Users hold alerts on the coins in the first list.**
 * Their alerts would have stopped firing with nothing anywhere reporting it - the cron would
 * have logged a healthy run over a different 50.
 *
 * So membership stays editorial and the DATA stays generated. The ids below are the hand-written
 * list this app shipped with; symbols, decimals, labels and price multipliers for them all come
 * from the generated universe, so adding a coin here is still one edit rather than five.
 *
 * Every id is asserted to exist in the universe at module load - see below. */
const RENDERED_IDS: readonly string[] = [
  'btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui',
  'doge', 'avax', 'link', 'ada', 'dot', 'atom', 'wif', 'pepe', 'bonk',
  'ltc', 'bch', 'trx', 'xlm', 'etc', 'fil',
  'arb', 'op', 'apt', 'sei', 'inj', 'tia',
  'aave', 'uni', 'ldo', 'rune', 'gmx', 'crv',
  'stx', 'jup', 'wld', 'render', 'tao', 'fet',
  'ondo', 'pyth', 'ena', 'dydx',
  'sand', 'mana', 'gmt',
  'xau', 'spx',
];

/* A CURATED ID THAT THE UNIVERSE DOES NOT CARRY IS A BUILD ERROR, not a silently shorter list.
 * Dropping it quietly is the failure this whole comment is about: the app would render 49 coins
 * and nothing would say which one went. Today the count is 0. */
const MISSING = RENDERED_IDS.filter(id => !BY_ID.has(id));
if (MISSING.length) {
  throw new Error(
    `lib/coins.ts: ${MISSING.length} curated coin(s) are absent from the generated universe: ` +
    `${MISSING.join(', ')}. Regenerate with scripts/generate-coins.mjs, or remove them here - ` +
    `but decide, because they are rendered and alerted on today.`,
  );
}

/** The coins the app renders, in the order it has always rendered them. */
export const COINS: CoinId[] = [...RENDERED_IDS];

/* WHAT THE ALERT CRON SCANS. It is `COINS`, deliberately and not a slice.
 *
 * `app/api/telegram/alert/route.ts` fetches 300 klines PER COIN on every run - `checkRSI` alone
 * is `runBatched(COINS.map(...))` - so the scan's cost tracks this list's length. Keeping it
 * equal to what the app renders means a user can only hold an alert on a coin the cron actually
 * looks at. The two drifting apart is how an alert goes quiet without an error.
 *
 * It was `COINS.slice(0, 50)` of the 463-long universe, which held the COST at 50 while silently
 * changing WHICH 50 - see the measurement above. Cost was the only thing that version checked.
 *
 * THE RIGHT ANSWER IS SMALLER THAN THIS and is the next change, not this one: scan the union of
 * coins at least one recipient has NOT muted. Mute keys are already `coin:<id>` and today's two
 * recipients have muted 46 and 47 coins each, so the real working set is about four. That would
 * be cheaper than today at any list length. It needs `mutedByUser` threaded into the check
 * functions, a refactor of a 2,400-line route. */
export const SCAN_LIMIT = 50;
export const SCANNED_COINS: CoinId[] = COINS;

/** The row behind a coin, or undefined for an id this build does not serve. */
export function coinRow(coin: string): CoinRow | undefined {
  return BY_ID.get(coin);
}

/* THESE TWO MAPS COVER WHAT THE APP RENDERS, NOT THE WHOLE UNIVERSE, and that is load-bearing
 * rather than tidy.
 *
 * 29 call sites iterate them wholesale - `Object.values(BINANCE_SYMS)`, `Object.keys(BYBIT_SYMS)`,
 * `Object.entries(...)` - and every one of them is a fan-out. Built over all 463 they became:
 *
 *   MarketProvider        one WebSocket subscription per symbol, 462 streams instead of 50
 *                         a 7,828-character GET for the 24h poll, up from about 860 - close
 *                         enough to the usual 8 KB request-line cap to fail in some proxy paths
 *                         462 concurrent requests in the open-interest fan-out
 *   telegram/alert        runBatched over BYBIT_SYMS at 300 klines per coin, TWICE
 *   bybitFanout, LiqFeed  the same multiplication again
 *
 * `SCANNED_COINS` was supposed to be what held the cron's cost down, and it does not reach any of
 * this: those loops never mention COINS. **A bound that the hot paths do not go through is not a
 * bound.** Keeping the maps at the rendered list is what actually holds it, because the fan-outs
 * read the map.
 *
 * The universe is still reachable per-coin through `coinRow(id)`, which is how an opt-in surface
 * gets a symbol for an instrument outside the rendered 50 - one id at a time, deliberately,
 * rather than by iterating a map that something else also iterates. */
/* FOUR COINS THE GENERATOR FOUND ON BINANCE ARE HELD BACK, each for a reason that has to be
 * closed before the failover is worth having. The hand table excluded all four and was right to,
 * even though its stated reason covered only two of them.
 *
 *   pepe, bonk  Binance lists them as 1000PEPEUSDT / 1000BONKUSDT, so every price read from
 *               Binance is 1000x the per-token price the rest of the app uses. The row carries
 *               `binanceMult` for exactly this and `binancePriceFactor` exists to apply it -
 *               and it has ZERO call sites. Adding the symbols before the factor is applied is
 *               the Bybit bug again: silent, two coins, and it put PEPE and BONK alert outcomes
 *               at +/-100,000% last time, dragging the Track Record average to -126%.
 *
 * `spx` and `hype` WERE held here on a suspected ticker collision and are now released, because
 * the identities were checked against both venues' instrument metadata rather than reasoned
 * about, and both venues agree:
 *
 *     SPXUSDT   bybit baseCoin=SPX  $0.3622    binance baseAsset=SPX  $0.3628    0.17% apart
 *     HYPEUSDT  bybit baseCoin=HYPE $90.059    binance baseAsset=HYPE $90.131    0.08% apart
 *
 * So the failover is safe for both, and those two coins gain a second source they have never
 * had. **SPX turned out to be a different problem entirely** - it is SPX6900, a memecoin, and
 * the app was calling it the S&P 500. That is fixed at the label and in the classifier, not here.
 *
 * This is the one place a generated list is overridden by hand, so it names each coin and what
 * would remove it from the list rather than being a bare exclusion set. */
const BINANCE_HOLD = new Set(['pepe', 'bonk']);

export const BINANCE_SYMS: Record<string, string> = Object.fromEntries(
  RENDERED_IDS
    .filter(id => !BINANCE_HOLD.has(id))
    .map(id => [id, BY_ID.get(id)?.binance])
    .filter(([, s]) => s) as [string, string][],
);

// Bybit linear perp symbols - includes the 1000x meme listings and the synthetics.
export const BYBIT_SYMS: Record<string, string> = Object.fromEntries(
  RENDERED_IDS.map(id => [id, BY_ID.get(id)?.bybit]).filter(([, s]) => s) as [string, string][],
);

/* IS THERE A SECOND SOURCE FOR THIS COIN? ANSWERED FROM THE SHIPPED MAPS, not from the
 * generated row, and the difference was a lie about the one thing this function exists to say.
 *
 * It used to read `BY_ID.get(coin)?.oneVenue`, which is what the EXCHANGES list. The failover
 * reads `BINANCE_SYMS`, which is what WE ship - and those disagree for `pepe` and `bonk`:
 *
 *     generated row   { id: 'pepe', bybit: '1000PEPEUSDT', binance: '1000PEPEUSDT', oneVenue: false }
 *     shipped maps    bybit = 1000PEPEUSDT   binance = ABSENT   (held back, see BINANCE_HOLD)
 *     old answer      isSingleVenue('pepe') === false   -> "yes, there is a failover"
 *
 * So a caller asked "is there a second source?", was told yes, and would have found out there
 * was not **during an outage** - which is the exact moment this function exists to prevent. The
 * irony is that pepe and bonk are the two coins whose Binance listing was the discovery that
 * justified generating this file at all; the editorial map then dropped them for a display
 * reason and nothing told the flag. Found by QA's fixtures, not by me.
 *
 * Deriving it from the two maps means it cannot disagree with them, because they ARE the answer.
 * An id in neither map is not served at all, so there is no failover for it either - `true` is
 * the honest answer and `coinRow(id)` is how you ask the different question of whether the
 * exchanges list it. */
export function isSingleVenue(coin: string): boolean {
  return !(BYBIT_SYMS[coin] && BINANCE_SYMS[coin]);
}

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
 * 45 of the previous 50 hand-written values are kept. Five differ because the
 * exchange disagrees with what was typed, and the exchange is the authority on its own tick:
 *
 *     sol  3 -> 2     near 4 -> 3     dot  3 -> 4
 *     dydx 4 -> 5     gmt  5 -> 6
 *
 * Two of those show MORE precision than before and three show less. The three that show
 * less are cases where the hand table displayed a digit the venue does not quote.
 *
 * btc would have been a sixth (2 -> 1) and is pinned below instead. */
/* BTC IS PINNED AT TWO DECIMALS AND THE OTHER FIVE FOLLOW THE VENUE. PM's call, and the reason
 * is about reading rather than about correctness: Bybit quotes BTC to a 0.1 tick, so one decimal
 * is what the exchange says - but a BTC price that suddenly shows one decimal place reads as
 * BROKEN, not as precise, on a product whose whole claim is accurate numbers. The other five
 * move: more precision cannot make a number wrong, and dropping a digit the venue does not quote
 * is a correction.
 *
 * This is the only hand override of generated data outside BINANCE_HOLD, and it is a display
 * choice, not a data claim - the price itself is untouched. Remove the line to adopt the tick. */
const DEC_PIN: Record<string, number> = { btc: 2 };

export const COIN_DEC: Record<string, number> = Object.fromEntries(
  COIN_UNIVERSE.map(r => [r.id, DEC_PIN[r.id] ?? r.dec]),
);

/* ONE LABEL IS OVERRIDDEN, BECAUSE THE TICKER LIES.
 *
 * `SPXUSDT` is SPX6900, a memecoin. Checked against both venues' instrument metadata rather
 * than assumed: Bybit baseCoin=SPX at $0.3622, Binance baseAsset=SPX at $0.3628, 0.17% apart,
 * same asset. **The S&P 500 is around 6,800.** The control that makes this readable is XAUUSDT
 * on the same venue at $3,886 - real gold - so Bybit does list genuine synthetics and $0.36 is
 * not an artefact of how these are quoted.
 *
 * Rendering it as `SPX` beside `XAU` asserts "this is the S&P 500" to anyone reading the two
 * together, and this app separately carries the REAL index as `store.macro.spx` from Yahoo
 * ^GSPC, labelled SPX in the macro strip. One product, one name, two different things, nothing
 * on screen telling them apart - and the alert cron fires on the memecoin.
 *
 * So the coin is labelled SPX6900 and the macro strip keeps SPX, which is correct for it. */
const LABEL_OVERRIDE: Record<string, string> = { spx: 'SPX6900' };

/** Display label. The ticker is the label for every instrument, so this is derived rather
 *  than listed - a generated coin cannot arrive without one. */
export const COIN_LABELS: Record<string, string> = Object.fromEntries(
  COIN_UNIVERSE.map(r => [r.id, LABEL_OVERRIDE[r.id] ?? r.id.toUpperCase()]),
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
  if (row) return row.bybitMult;
  return BYBIT_SYMS[coin]?.startsWith('1000') ? 0.001 : 1;
}

/* THE SAME CONVERSION FOR BINANCE, AND IT IS NOT ALWAYS THE SAME NUMBER.
 *
 * Four instruments are quoted in different units by the two venues - `sats` is 10000SATS on
 * Bybit and 1000SATS on Binance, and toshi, tag and turbo are 1000x on Bybit and 1x on Binance.
 * A single factor describes one venue and is out by 10x to 1000x on the other.
 *
 * That matters precisely because of the failover: both venues are required so that a Bybit
 * outage has a second source, so a coin converted with the wrong venue's factor becomes wrong at
 * exactly the moment the fallback is used. Three of the four were safe only because of which
 * direction the conversion ran in, which is luck rather than design. Found by QA's step-0
 * fixtures; the per-venue split is the fix that closes the class rather than the instance. */
export function binancePriceFactor(coin: string): number {
  return BY_ID.get(coin)?.binanceMult ?? 1;
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
