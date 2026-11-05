#!/usr/bin/env node
/* Generates lib/coinUniverse.generated.ts from what the exchanges actually trade (#1263).
 *
 * WHY THIS EXISTS. The coin list was 50 entries hand-written across five maps - COINS,
 * BINANCE_SYMS, BYBIT_SYMS, COIN_DEC, COIN_LABELS - and every new coin meant five edits in
 * agreement with each other. The owner has asked twice for "as many coins as possible". A list
 * that has to be typed is a list that stays at 50.
 *
 * THE SELECTION RULE: an instrument we can serve is one BOTH exchanges trade as a USDT
 * perpetual, right now. Bybit is the default source and Binance is the failover
 * (lib/klinesFailover.ts), so a coin on only one venue has no second source - the intersection
 * is not caution, it is the failover guarantee expressed as a list.
 *
 * SINGLE-VENUE EXCEPTIONS ARE EXPLICIT AND SMALL. Three instruments we already serve exist on
 * one venue only and are kept deliberately, because dropping them would remove a product
 * feature to satisfy a rule: `xau` and `spx` are Bybit-only synthetics (gold and the S&P), and
 * `fet` is Binance-only. They carry `oneVenue: true` so a caller can tell that a failover is
 * not available for them, rather than discovering it during an outage.
 *
 * THE 1000x TRAP, which this generator exists partly to stop recurring. Bybit quotes low-value
 * memecoins per 1000 tokens - `1000PEPEUSDT`, `1000BONKUSDT` - so every price read from those
 * symbols is 1000x the per-token price. That was an inline ternary in two places and MISSED in
 * a third, which recorded PEPE and BONK alert outcomes at plus or minus 100,000% and dragged
 * the whole Alert Track Record to -126%. Here the multiplier is DERIVED from the symbol the
 * exchange actually returned and written into the generated row, so a new 1000x listing cannot
 * arrive without its factor.
 *
 * Run: node scripts/generate-coins.mjs          (writes the file)
 *      node scripts/generate-coins.mjs --check  (exits 1 if the file is stale; no write)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'coinUniverse.generated.ts');
const CHECK = process.argv.includes('--check');

/**
 * THREE TICKERS NAME A DIFFERENT ASSET ON ONE VENUE THAN THEY DO ON THE OTHERS, so that venue is
 * dropped from the row rather than shipped as a second source for a coin it does not trade.
 *
 * THIS IS A FAILURE CLASS NOBODY ON THE TEAM HAD NAMED, and the agreement guard below found all
 * three on its first run against live data. The generator pairs venues by normalised base symbol,
 * which is structurally blind to it: two exchanges can use one ticker for two unrelated assets and
 * nothing in the symbol says so. It is NOT the 1000x trap this file's header warns about - the
 * giveaway is that none of the three ratios is a round factor. A unit error is exactly 1000 or
 * 10000; these are 1266, 469 and 0.16, which is what two different assets look like.
 *
 * ALL THREE VENUES WERE READ FOR EACH ONE, which is the only way to tell WHICH is the odd one out,
 * and for `on` the answer is not the venue I first assumed:
 *
 *            bybit        binance      okx        odd one out
 *   on       70.51        0.1504       70.50      BINANCE   x469   <- not OKX
 *   bb       0.006871     0.006873     8.702      OKX       x1266
 *   qnt      203.34       203.37       32.46      OKX       x0.160
 *
 * EACH WAS CHECKED FOR THE INNOCENT EXPLANATIONS FIRST - a stale last price, or a market whose
 * last trade was months ago. All six markets are live, tightly quoted and actively traded with
 * coherent daily closes (`bb` oi $263k, `on` oi $244k, `qnt` oi $327k), so "wrong price on a dead
 * market" is ruled out rather than assumed.
 *
 * `on` WAS WRONG IN THE FILE BEFORE ANY OF THIS, AND IT STILL IS NOT AN OUTAGE AWAY FROM HARM.
 * The row shipped `{ bybit: 'ONUSDT', binance: 'ONUSDT' }` as if they were one asset. Nothing
 * reads it: both shipped maps are built from `RENDERED_IDS` (the 50 curated coins) and `on` is in
 * neither, so no price, candle, alert or outcome has ever touched it - 0 rows across four
 * production tables against a `btc` control of 1,302, and exactly 50 distinct coins recorded ever.
 * #1861 does not change that either; it wires the extra coins to Bybit only. So this is a latent
 * trap that goes live the first time somebody reads the `binance` column for a non-curated coin.
 *
 * WHY A LIST AND NOT AN AUTOMATIC DROP ON ANY MISMATCH. An automatic drop would silently turn a
 * real data problem into reduced coverage: the generator would stop offering a venue for a coin
 * whose price had gone wrong for some entirely different reason, and nobody would be told.
 * Refusing by default and naming the exceptions here is the same shape as ONE_VENUE_KEEP - a
 * judgment call that has to be read to be changed.
 */
const TICKER_COLLISIONS = new Map([
  ['bb', 'okx'],
  ['on', 'binance'],
  ['qnt', 'okx'],
]);

/** Kept although only one venue lists them - see the header. */
const ONE_VENUE_KEEP = new Set(['xau', 'spx', 'fet']);

const j = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
};

/**
 * `1000PEPE` -> { id: 'pepe', mult: 0.001 }. The multiplier converts that venue's quote to the
 * per-token price the app uses.
 *
 * ONLY THE PREFIXES A VENUE ACTUALLY QUOTES IN. The first version took any leading digits, and
 * **a leading digit in a quantity and a leading digit in a NAME are not distinguishable by
 * `/^(\d+)(.+)$/`.** Three real instruments are named with one:
 *
 *   0G    -> mult = 1/0 = Infinity   every price for that coin becomes Infinity
 *   2Z    -> mult = 0.5              every price halved
 *   1INCH -> id 'inch'               renders as INCH, charts as INCH/USDT
 *
 * `0G` also slipped the `dec !== null` filter, because `-log10(Infinity)` clamps to 0 instead of
 * producing NaN - so it shipped as a selectable coin with an infinite price. Found by QA's step-0
 * fixtures. It is the exact trap this file's header warns about, one function away from the
 * warning, which is the second time that has happened in this generator.
 *
 * Checked against all 463 rows: pepe, bonk, floki, mog, sats, rats, xec, cat, lunc, toshi, tag
 * and turbo are unchanged by the narrowing.
 */
function normaliseBase(base) {
  const m = /^(1000000|10000|1000)(.+)$/.exec(base);
  if (!m) return { id: base.toLowerCase(), mult: 1 };
  return { id: m[2].toLowerCase(), mult: 1 / Number(m[1]) };
}

/**
 * Decimals for the PER-TOKEN price, from the exchange's own tick size.
 *
 * THE MULTIPLIER HAS TO BE APPLIED HERE TOO, and the first version of this function did not -
 * which is the 1000x trap described in the header, reappearing one field away from the comment
 * warning about it. `1000PEPEUSDT` has a tick of 0.000001, so six decimals describe the price
 * of a THOUSAND tokens. The app displays one token, which needs three more. Caught by diffing
 * the generated values against the hand table: pepe and bonk came out at 6 where the hand
 * table said 8, and the hand table was right.
 *
 * Capped at 8 to match what the hand table shipped - the extra digit is below what any of
 * these venues quotes anyway.
 */
function decimalsFromTick(tick, mult = 1) {
  if (!(tick > 0)) return null;
  const perToken = tick * mult;
  const d = Math.round(-Math.log10(perToken));
  return Math.min(8, Math.max(0, d));
}

const [byInst, byTick, bnInfo, bnTick, okInst, okTick] = await Promise.all([
  j('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'),
  j('https://api.bybit.com/v5/market/tickers?category=linear'),
  j('https://fapi.binance.com/fapi/v1/exchangeInfo'),
  j('https://fapi.binance.com/fapi/v1/ticker/24hr'),
  /* OKX ANSWERS HTTP 200 WITH ITS ERROR IN THE BODY, so `j`'s `r.ok` check does not see one.
     An unknown instrument is `code: '51001'` and a bad parameter is `'51000'`, both on a 200.
     Checked rather than assumed, because a silent `{ code: '51001', data: [] }` would read here
     as "OKX lists nothing" and quietly strip the column from every row. */
  j('https://www.okx.com/api/v5/public/instruments?instType=SWAP'),
  j('https://www.okx.com/api/v5/market/tickers?instType=SWAP'),
]);
for (const [what, res] of [['instruments', okInst], ['tickers', okTick]]) {
  if (res.code !== '0') throw new Error(`OKX ${what} -> code ${res.code}: ${res.msg ?? ''}`);
  if (!Array.isArray(res.data) || res.data.length === 0) throw new Error(`OKX ${what} -> code 0 but no rows`);
}

const byTurnover = new Map((byTick.result?.list ?? []).map(t => [t.symbol, Number(t.turnover24h) || 0]));
/* LAST PRICES, for the unit guard near the end of this file and nothing else. Not emitted. */
const byLast = new Map((byTick.result?.list ?? []).map(t => [t.symbol, Number(t.lastPrice) || 0]));
const bybit = new Map();
for (const i of byInst.result?.list ?? []) {
  if (i.quoteCoin !== 'USDT' || i.status !== 'Trading' || i.contractType !== 'LinearPerpetual') continue;
  const { id, mult } = normaliseBase(i.baseCoin);
  bybit.set(id, {
    symbol: i.symbol,
    mult,
    tick: Number(i.priceFilter?.tickSize) || 0,
    turnover: byTurnover.get(i.symbol) ?? 0,
  });
}

const bnVolume = new Map(bnTick.map(t => [t.symbol, Number(t.quoteVolume) || 0]));
const bnLast = new Map(bnTick.map(t => [t.symbol, Number(t.lastPrice) || 0]));
const binance = new Map();
for (const s of bnInfo.symbols ?? []) {
  if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING' || s.contractType !== 'PERPETUAL') continue;
  const { id, mult } = normaliseBase(s.baseAsset);
  const tick = Number((s.filters ?? []).find(f => f.filterType === 'PRICE_FILTER')?.tickSize) || 0;
  binance.set(id, { symbol: s.symbol, mult, tick, volume: bnVolume.get(s.symbol) ?? 0 });
}

/* OKX, AS A THIRD COLUMN ONLY - IT DOES NOT CHANGE WHICH COINS EXIST.
 *
 * `ids` below is still Bybit ∩ Binance plus ONE_VENUE_KEEP. An instrument OKX lists and the other
 * two do not is NOT added: widening the universe is a separate decision with its own effect on
 * every scanner and every fan-out, and bundling it into "add a third venue column" would hide it.
 *
 * `okxLast` IS NOT EMITTED. It exists only for the unit guard below. A price in a generated file
 * is stale the moment it is written, and `liq` is already dropped from the row for that reason -
 * a field nobody reads is a field that will be trusted. */
const okxLast = new Map();
const okx = new Map();
{
  const px = new Map(okTick.data.map(t => [t.instId, Number(t.last) || 0]));
  for (const i of okInst.data) {
    /* `state: 'live'` and USDT-settled linear swaps only - the same filter shape as the other two
       venues. A `preopen` or `suspend` instrument answers requests and should not be a fallback. */
    if (i.instType !== 'SWAP' || i.settleCcy !== 'USDT' || i.state !== 'live') continue;
    const m = /^(.+)-USDT-SWAP$/.exec(i.instId);
    if (!m) continue;
    /* Through `normaliseBase` like the other two, although OKX quotes no 1000x symbol today
       (`1000PEPE-USDT-SWAP` is not listed; measured). If it ever lists one, this produces the
       multiplier and the guard below catches the mismatch rather than shipping a 1000x price. */
    const { id, mult } = normaliseBase(m[1]);
    okx.set(id, { instId: i.instId, mult });
    const last = px.get(i.instId) ?? 0;
    if (last > 0) okxLast.set(id, last * mult);
  }
}

const ids = new Set([...bybit.keys()].filter(id => binance.has(id)));
for (const id of ONE_VENUE_KEEP) if (bybit.has(id) || binance.has(id)) ids.add(id);

const rows = [...ids].map(id => {
  /* THE COLLIDING VENUE IS DROPPED HERE, AT THE TOP, so everything below follows from the venues
     the row actually keeps: the multiplier, the decimals, `oneVenue` and the liquidity rank.
     Dropping it only in the emitted field would leave `dec` and `oneVenue` describing a venue the
     row does not carry - which is the `isSingleVenue` bug in this file's history, where the flag
     and the shipped maps disagreed about whether a failover existed. */
  const drop = TICKER_COLLISIONS.get(id);
  const b = drop === 'bybit' ? undefined : bybit.get(id);
  const n = drop === 'binance' ? undefined : binance.get(id);
  if (!b && !n) {
    /* Refused rather than crashed on the `n.tick` below. A collision that removes a coin's only
       venue means the coin should leave the universe, which is a decision, not a null field. */
    console.error(`TICKER_COLLISIONS drops ${drop} for '${id}', which was its only venue.`);
    console.error('  Remove the id from the universe instead, or reconsider which venue is the odd one out.');
    process.exit(2);
  }
  const oneVenue = !b || !n;
  /* Rank on the THINNER venue: a coin is only as tradable as its weaker side, and that is the
     side a failover read lands on. A single-venue instrument ranks on the venue it has. */
  const liq = oneVenue ? (b?.turnover ?? n?.volume ?? 0) : Math.min(b.turnover, n.volume);
  /* ONE MULTIPLIER PER VENUE, because the two venues do not always agree.
     `sats` is quoted as 10000SATS on Bybit and 1000SATS on Binance, so a single `mult` describes
     one of them and is out by 10x on the other. A failover read - the entire reason both venues
     are required - would then return a wrong price at exactly the moment the primary fails.
     `toshi`, `tag` and `turbo` differ the same way and were safe only because of which direction
     the conversion happens to run in. That is luck, not design, and a price wrong by 10x to
     1000x is wrong data rather than sparse data. */
  return {
    id,
    bybit: b?.symbol ?? null,
    binance: n?.symbol ?? null,
    /* THIRD VENUE, SYMBOL ONLY - no `okxMult`, because OKX quotes every one of these per token.
       Measured on two independent channels rather than assumed: OKX's PEPE last is 0.000004963
       while Bybit's 1000PEPEUSDT/1000 is 0.000004958 and Binance's is 0.0000049638, a ratio of
       1.0010. `ctVal` is the CONTRACT SIZE (10,000,000 PEPE for PEPE-USDT-SWAP) and is not a
       price factor; deriving a multiplier from it would multiply that price by ten million.
       `1000PEPE-USDT-SWAP` is not listed at all - the 1000x prefix is a Bybit and Binance symbol
       -naming artifact, not a property every venue has. The guard below re-measures this on every
       generation so the next venue change cannot smuggle a unit error in. */
    okx: drop === 'okx' ? null : (okx.get(id)?.instId ?? null),
    bybitMult: b?.mult ?? 1,
    binanceMult: n?.mult ?? 1,
    /* Decimals follow Bybit, the default price source, falling back to Binance when that is the
       only venue. */
    dec: b ? decimalsFromTick(b.tick, b.mult) : decimalsFromTick(n.tick, n.mult),
    oneVenue,
    liq,
  };
}).filter(r => r.dec !== null)
  /* SORTED BY ID, NOT BY LIQUIDITY, AND THE RANK IS GONE RATHER THAN HIDDEN.

     This was `.sort((a, b) => b.liq - a.liq)`. Turnover moves every hour, so every run
     reordered most of the file: a regeneration today rewrote 374 of 463 rows while **zero
     rows changed content** - measured by comparing the two row sets order-independently.
     `--check` therefore reported STALE permanently, which is a check that can only ever
     return one answer and so carries no information. Nothing gates on it, which is the only
     reason that went unnoticed.

     AND THE SORT DID NOT FIX THE CHECK - it fixed one of two causes. `--check` still returned
     STALE on every Windows checkout after this landed, on line endings. See the normalisation
     in the `--check` block below. Left as two paragraphs rather than rewritten into one,
     because "a stable sort makes the check informative" is the inference that was wrong.

     THE RANK WAS CONSUMED BY NOTHING. `UNIVERSE_COINS` exports the order as an array and has
     no reader outside `lib/coins.ts`; the Arena scanner builds from `COINS` and re-sorts by
     live `vol24` (app/(main)/arena/page.tsx:1747). So the ordering never reached a screen.

     A stable order makes the next regeneration diff only what actually changed, which is what
     makes adding a third venue reviewable instead of a 748-line reshuffle with the real change
     somewhere inside it. `liq` is still computed and still filters nothing - it is dropped from
     the emitted row below, because a field nobody reads is a field that will be trusted. */
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/* THE AGREEMENT GUARD: do the venues mean the same ASSET, and quote it in the same UNIT?
 *
 * WHY IT EXISTS. PM's instruction for this change was to derive an `okxMult` from OKX's `ctVal`,
 * on the reasonable assumption that a venue listing memecoins must scale them somehow. It does
 * not: `ctVal` is the CONTRACT SIZE (10,000,000 PEPE for `PEPE-USDT-SWAP`) and OKX quotes the
 * price per token, so a ctVal-derived multiplier would have multiplied PEPE by ten million.
 * That was caught by measuring before writing, and this guard is that measurement, kept.
 *
 * IT COMPARES EVERY PAIR, NOT JUST THE NEW VENUE. PM asked for the 1000x rows against OKX, which
 * is the high-risk subset rather than the class - and restricting it to OKX would have left the
 * `on` row below shipping a 469x error indefinitely, because that one is Bybit against BINANCE.
 * A guard that names its exceptions has not named what it is guarding. All three pairs, every
 * row: the prices are already fetched for turnover, so it costs nothing.
 *
 * IT READS THE ROW'S OWN EMITTED FIELDS rather than the venue maps, so it checks what actually
 * ships. A venue dropped by TICKER_COLLISIONS is `null` on the row and is therefore not compared
 * - which is what lets a known collision pass without widening the band for everyone.
 *
 * THE BAND IS WIDE ON PURPOSE, AND IT IS NOT PM'S SUGGESTED 0.95-1.05.
 * A unit error is a factor of 1,000 or 10,000,000, and a ticker collision is whatever two
 * unrelated assets happen to cost. Market divergence between two venues on a thin instrument
 * during a fast move is a few per cent and can briefly be more. A band tight enough to catch
 * drift would refuse a generation on market noise - and a gate that cries wolf is a gate
 * somebody deletes, which costs more than it ever saved. So:
 *   REFUSE outside [0.5, 2.0]  - cannot fire on market noise; catches any real mismatch, the
 *                                smallest of the three found so far being a factor of 469
 *   WARN   outside [0.9, 1.1]  - visible without blocking, for a divergence worth a look
 *
 * AND A ZERO HERE IS A FAILURE, NOT A PASS. If nothing got compared - a ticker endpoint empty, or
 * the last-prices missing - then "no mismatches" measures the instrument and not the data, so the
 * comparison count is asserted before the verdict is trusted. */
const UNIT_REFUSE = [0.5, 2.0];
const UNIT_WARN = [0.9, 1.1];

/** Per-token prices for a row, from the venues the row actually carries. */
function venuePrices(r) {
  const out = [];
  const push = (venue, p) => { if (p > 0) out.push([venue, p]); };
  if (r.bybit) push('bybit', (byLast.get(r.bybit) ?? 0) * r.bybitMult);
  if (r.binance) push('binance', (bnLast.get(r.binance) ?? 0) * r.binanceMult);
  if (r.okx) push('okx', okxLast.get(r.id) ?? 0);
  return out;
}

const unitChecks = [];
const unitRefuse = [];
const unitWarn = [];
let unitScaled = 0;
for (const r of rows) {
  const px = venuePrices(r);
  if (px.length < 2) continue;
  if (r.bybitMult !== 1 || r.binanceMult !== 1) unitScaled++;
  for (let i = 0; i < px.length; i++) {
    for (let k = i + 1; k < px.length; k++) {
      const [va, pa] = px[i];
      const [vb, pb] = px[k];
      const ratio = pa / pb;
      unitChecks.push(ratio);
      if (ratio < UNIT_REFUSE[0] || ratio > UNIT_REFUSE[1]) {
        unitRefuse.push(`${r.id}: ${va} ${pa} vs ${vb} ${pb} -> x${ratio.toExponential(3)}`);
      } else if (ratio < UNIT_WARN[0] || ratio > UNIT_WARN[1]) {
        unitWarn.push(`${r.id}: ${va}/${vb} = ${ratio.toFixed(3)}`);
      }
    }
  }
}
if (unitChecks.length === 0) {
  console.error('AGREEMENT GUARD COMPARED NOTHING: no row carried two venue prices.');
  console.error('  That is an instrument failure, not a clean result - refusing rather than reporting zero problems.');
  process.exit(2);
}
if (unitRefuse.length) {
  console.error(`VENUE DISAGREEMENT on ${unitRefuse.length} of ${unitChecks.length} comparisons:`);
  for (const line of unitRefuse.slice(0, 12)) console.error(`  ${line}`);
  console.error('  A ROUND ratio (1000, 10000) means a venue scales that instrument and needs a multiplier.');
  console.error('  A ratio that is NOT round means the two venues mean DIFFERENT ASSETS by one ticker: check');
  console.error('  all three venues, decide which is the odd one out, and add it to TICKER_COLLISIONS.');
  console.error('  Do NOT widen the band to make this pass - a wrong price is wrong data, not sparse data.');
  process.exit(2);
}
console.log(`agreement guard: ${unitChecks.length} cross-venue price comparisons`
  + ` over ${rows.filter(r => venuePrices(r).length >= 2).length} rows`
  + ` (${unitScaled} scaled 1000x+ on Bybit or Binance), 0 disagreements`
  + (unitWarn.length ? `, ${unitWarn.length} over 10% apart: ${unitWarn.slice(0, 6).join(', ')}` : ''));

/* TICKER_COLLISIONS HAS ITS OWN EXPIRY, re-measured on every generation.
 *
 * An entry costs a venue for that coin FOREVER if the collision ever ends - the exchange relists
 * the ticker as the asset the others mean, and nothing in this repository would look again. That
 * is the `RELEASE_PR_PAUSED` shape: correct the day it is written, wrong to whoever finds it next,
 * with nothing watching the date. So the list reports on itself.
 *
 * THIS CHECK EARNED ITS PLACE WITHIN FIVE MINUTES OF BEING WRITTEN. All three ids were first
 * excluded as OKX collisions; this re-check immediately answered `on: 1.000 - NOT A COLLISION ANY
 * MORE`, because my original comparison used Binance as the reference and this one used Bybit.
 * Bybit and OKX agree on `on` to four digits and Binance is the outlier, so the venue to drop was
 * Binance. Without the re-check, `bb` and `qnt` would have been right, `on` would have been wrong
 * in a way that still looked handled, and the real 469x bug would have stayed in the file.
 *
 * Deliberately NOT automatic, in either direction. Dropping a venue and regaining one both change
 * which prices the app serves, and that is a decision a person makes after reading the numbers. */
const collisionReview = [];
for (const [id, dropped] of TICKER_COLLISIONS) {
  const r = rows.find(row => row.id === id);
  if (!r) { collisionReview.push(`${id}: no longer in the universe at all - the entry is dead, remove it`); continue; }
  const theirs = dropped === 'bybit' ? (byLast.get(bybit.get(id)?.symbol) ?? 0) * (bybit.get(id)?.mult ?? 1)
    : dropped === 'binance' ? (bnLast.get(binance.get(id)?.symbol) ?? 0) * (binance.get(id)?.mult ?? 1)
    : (okxLast.get(id) ?? 0);
  const kept = venuePrices(r);
  if (!(theirs > 0) || kept.length === 0) {
    /* Reported rather than ignored: an entry that cannot be re-measured is an entry whose
       exclusion is no longer backed by anything, which is a different state from "still valid". */
    collisionReview.push(`${id}: cannot re-measure the dropped ${dropped} - it may have delisted, or a price is missing`);
    continue;
  }
  const ratio = theirs / kept[0][1];
  if (ratio >= UNIT_WARN[0] && ratio <= UNIT_WARN[1]) {
    collisionReview.push(`${id}: the dropped ${dropped} now agrees with ${kept[0][0]} (${ratio.toFixed(3)})`
      + ` - NOT A COLLISION ANY MORE. Remove the entry to regain that venue.`);
  }
}
if (collisionReview.length) {
  console.log(`TICKER_COLLISIONS needs a human look (${collisionReview.length} of ${TICKER_COLLISIONS.size}):`);
  for (const line of collisionReview) console.log(`  ${line}`);
}

/* NO TWO ROWS MAY SHARE AN `id`, AND THIS IS THE ONE WAY THE SORT ABOVE HAS TEETH.
 *
 * `lib/coins.ts:31` builds `new Map(COIN_UNIVERSE.map(r => [r.id, r]))`, and a Map keeps the
 * LAST entry for a duplicated key. So with a duplicate id the ROW ORDER decides which row the
 * app uses - and the evidence that cleared the reorder in #1933, "the row set is identical, 0
 * added, 0 removed, 0 changed", stays TRUE while that happens. An order-independent set
 * comparison cannot see it. QA found this reviewing #1933; no id is duplicated today.
 *
 * It gets teeth the moment a venue adds ids, which is the next change to this file. Checked
 * here rather than in a test because the generator is the only thing that can produce one, and
 * a check in the producer cannot be bypassed by regenerating.
 *
 * EXIT 2, NOT 1. `--check` already owns 1 for "stale", and a stale file and a corrupt one are
 * different answers that need different reactions - one says regenerate, the other says do not
 * commit what you just generated. */
const idCounts = new Map();
for (const r of rows) idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
const dupes = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`);
if (dupes.length) {
  console.error(`DUPLICATE IDS (${dupes.length}): ${dupes.join(', ')}`);
  console.error('  lib/coins.ts keys a Map by id, so a duplicate silently drops a row and lets the');
  console.error('  sort order pick which one survives. Fix the id derivation, never the order.');
  process.exit(2);
}

/* ── BINANCE SPOT LISTING: THE `binance` COLUMN IS A FUTURES FACT AND DOES NOT COVER SPOT ───────
 *
 * Every symbol in this file's `binance` column comes from `fapi/v1/exchangeInfo`. The app also
 * calls SPOT endpoints (`api.binance.com/api/v3/*`) with those same symbols, and the two markets
 * list different things. `SPXUSDT` is on futures and NOT on spot.
 *
 * That cost more than one coin, because Binance's batched `api/v3/ticker/24hr?symbols=[...]`
 * rejects the ENTIRE request on one unlisted symbol with `400 -1121`. So the market snapshot's
 * spot call returned nothing on every run for as long as SPX has been in the universe, the futures
 * fallback always took over, and `source` was permanently `'futures'` - with no visible symptom,
 * since the app still had prices. Found by QA on #1651.
 *
 * `lib/coins.ts` holds the exclusion by hand (`BINANCE_SPOT_HOLD`), because a hand list that names
 * each coin is more honest than a derived one here would be - the `binance` column still means
 * "futures", and overloading it would hide which market a symbol was proved on.
 *
 * SO THIS CHECKS BOTH DIRECTIONS, and the second one is the one that rots quietly:
 *
 *   - a symbol the app WILL send to spot that spot does not list -> the -1121 again, on every run
 *   - a symbol held out of the spot list that HAS started trading on spot -> a working source
 *     silently excluded forever, which nothing would ever surface
 *
 * REFUSES rather than warns, same as the unit-agreement check: a generation that writes a file
 * whose spot batch is known-broken is worse than no generation. Exit 2 for the same reason as the
 * duplicate-id guard - "do not commit what you just generated", not "regenerate".
 *
 * THE HOLD LIST IS READ FROM lib/coins.ts, NOT DUPLICATED HERE. A second copy would drift, and the
 * drift would disable the check that exists to catch drift. */
const spotInfo = await j('https://api.binance.com/api/v3/exchangeInfo');
const spotListed = new Set(
  (spotInfo.symbols ?? []).filter(s => s.status === 'TRADING').map(s => s.symbol),
);
if (spotListed.size === 0) {
  console.error('binance SPOT exchangeInfo returned no TRADING symbols - refusing to judge the');
  console.error('  spot list against an empty set, which would "pass" every symbol.');
  process.exit(2);
}

const coinsSrc = readFileSync(new URL('../lib/coins.ts', import.meta.url), 'utf8');

/* THREE LISTS, ALL READ FROM lib/coins.ts RATHER THAN COPIED. A copy would drift, and the drift
   would disable the very check that exists to catch drift. */
const listFromCoins = (decl, re) => {
  const m = re.exec(coinsSrc);
  if (!m) {
    console.error(`could not find ${decl} in lib/coins.ts.`);
    console.error('  This check reads it from there on purpose - a copy here would drift. If the');
    console.error('  declaration was renamed, update this regex rather than hardcoding the list.');
    process.exit(2);
  }
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
};
const spotHold = listFromCoins('BINANCE_SPOT_HOLD',
  /const BINANCE_SPOT_HOLD = new Set\(\[([^\]]*)\]\)/);
const binanceHold = listFromCoins('BINANCE_HOLD',
  /const BINANCE_HOLD = new Set\(\[([^\]]*)\]\)/);
const renderedIds = listFromCoins('RENDERED_IDS',
  /const RENDERED_IDS: readonly string\[\] = \[([\s\S]*?)\];/);
if (renderedIds.size === 0) {
  console.error('RENDERED_IDS parsed as empty - refusing to check an empty set, which passes everything.');
  process.exit(2);
}

/* ONLY THE CURATED COINS, AND GETTING THIS WRONG IS WHY THE FIRST VERSION OF THIS CHECK WAS
   USELESS. It looped every row in the 463-instrument universe and reported **137 problems** on a
   tree that was perfectly fine - because `BINANCE_SYMS` is built from `RENDERED_IDS`, not from the
   whole universe, so the app never sends those other 400-odd symbols to spot at all. A guard that
   fires on every generation gets switched off, not obeyed.

   Caught by running the negative control - the check against the unmodified tree - rather than only
   the positive one. The positive control "passed" in the sense that it failed, which is exactly how
   a guard this broken can look correct. */
const spotProblems = [];
for (const r of rows) {
  if (!r.binance) continue;
  if (!renderedIds.has(r.id)) continue;   // not rendered -> never sent to spot
  if (binanceHold.has(r.id)) continue;    // not in BINANCE_SYMS at all, so not in the spot map
  const held = spotHold.has(r.id);
  const listed = spotListed.has(r.binance);
  if (!held && !listed) {
    spotProblems.push(
      `${r.id} (${r.binance}): the app sends this to SPOT but spot does not list it. One such `
      + 'symbol makes the whole batched ticker call fail with -1121. Add it to '
      + "BINANCE_SPOT_HOLD in lib/coins.ts.",
    );
  } else if (held && listed) {
    spotProblems.push(
      `${r.id} (${r.binance}): held out of the spot list but spot DOES list it now. Remove it `
      + 'from BINANCE_SPOT_HOLD - it is a working source being excluded for no reason.',
    );
  }
}
if (spotProblems.length) {
  console.error(`BINANCE SPOT LIST DISAGREES WITH THE VENUE (${spotProblems.length}):`);
  for (const p of spotProblems) console.error(`  - ${p}`);
  process.exit(2);
}
console.log(`binance spot list agrees with the venue (${spotListed.size} spot symbols checked)`);

/* ── HYPERLIQUID NAMES: THE SAME "DIFFERENT ASSET, SAME TICKER" CHECK AS THE OKX UNIT GUARD ────
 *
 * `lib/coins.ts`'s `HL_SYMS` is hand-listed, because Hyperliquid names an instrument by its bare
 * base (`BTC`, `kPEPE`) and `id.toUpperCase()` would be right for 46 of 48 and silently wrong on
 * the day a venue names a DIFFERENT asset by a ticker we already use. That is the `BB`/`QNT`
 * problem, which was off by factors of 1266 and 0.16.
 *
 * A hand list cannot notice a collision arriving later, so this re-measures every entry against
 * Binance or Bybit per-token on each generation and REFUSES to write the file if any pair
 * disagrees by more than 5%. Measured 2026-11-06: all 48 agree to within 0.11%, so the band is
 * loose enough never to fire on venue spread and tight enough that a different asset cannot hide.
 *
 * READS THE MAP FROM lib/coins.ts rather than rebuilding it, same as the spot-hold check above:
 * a second copy would drift, and the drift would disable the check that exists to catch drift.
 *
 * SKIPPED, NOT FAILED, IF HYPERLIQUID IS UNREACHABLE. The other venues' checks guard data this
 * file WRITES; this one guards a hand-maintained map in another file, so a venue outage must not
 * block an unrelated regeneration. It says so loudly instead - a silent skip would be the
 * "produces nothing, reads as all clear" shape this project has already paid for. */
const HL_REFUSE_RATIO = 0.05;
const hlNamesMatch = /const HL_NAMES: Readonly<Record<string, string>> = \{([\s\S]*?)\};/.exec(coinsSrc);
if (!hlNamesMatch) {
  console.error('could not find HL_NAMES in lib/coins.ts - update this regex rather than skipping the check.');
  process.exit(2);
}
const hlPairs = [...hlNamesMatch[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]]);
if (hlPairs.length === 0) {
  console.error('HL_NAMES parsed as empty - refusing to "pass" a check with nothing in it.');
  process.exit(2);
}

let hlCtx = null;
try {
  const r = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  if (r.ok) hlCtx = await r.json();
} catch { /* handled below */ }

if (!hlCtx || !Array.isArray(hlCtx) || hlCtx.length < 2) {
  console.warn(`SKIPPED the hyperliquid agreement check - venue unreachable. ${hlPairs.length} HL_SYMS entries NOT verified this run.`);
} else {
  const [hlMeta, hlCtxs] = hlCtx;
  const hlPx = new Map();
  (hlMeta.universe ?? []).forEach((u, i) => {
    const px = hlCtxs[i]?.markPx ?? hlCtxs[i]?.midPx;
    if (px) hlPx.set(u.name, Number(px));
  });
  const hlProblems = [];
  let hlChecked = 0, hlWorst = 0;
  for (const [id, name] of hlPairs) {
    const row = rows.find(r => r.id === id);
    if (!row) { hlProblems.push(`${id} (${name}): HL_NAMES names an id the universe does not carry`); continue; }
    const hl = hlPx.get(name);
    if (hl == null) { hlProblems.push(`${id} (${name}): hyperliquid no longer lists this name`); continue; }
    /* The `k` prefix is 1000 for every name in this map - kPEPE and kBONK - and lib/hyperliquid.ts
       refuses any k-name whose multiplier is unverified, so an unverified one never reaches here. */
    const perToken = /^k[A-Z]/.test(name) ? hl / 1000 : hl;
    /* `venuePrices` is the SAME per-token helper the unit-agreement guard above uses, rather than a
       second price lookup written for this check. It already applies each venue's own multiplier,
       which is the part a hand-rolled reference would get wrong. */
    const px = venuePrices(row);
    if (px.length === 0) { hlProblems.push(`${id} (${name}): no cross-venue reference to check against`); continue; }
    const [refVenue, ref] = px[0];
    if (!(ref > 0)) { hlProblems.push(`${id} (${name}): reference venue ${refVenue} gave no usable price`); continue; }
    const d = Math.abs(perToken - ref) / ref;
    hlChecked++;
    if (d > hlWorst) hlWorst = d;
    if (d > HL_REFUSE_RATIO) {
      hlProblems.push(`${id} (${name}): hyperliquid ${perToken} vs ${refVenue} ${ref} = ${(d * 100).toFixed(1)}% apart - probably a DIFFERENT ASSET by the same ticker`);
    }
  }
  if (hlProblems.length) {
    console.error(`HYPERLIQUID NAMES DISAGREE WITH THE VENUE (${hlProblems.length}):`);
    for (const p of hlProblems) console.error(`  - ${p}`);
    console.error('  Fix lib/coins.ts HL_NAMES. A name that disagrees must be REMOVED, not adjusted:');
    console.error('  a multiplier that makes two different assets agree is a coincidence, not a conversion.');
    process.exit(2);
  }
  console.log(`hyperliquid names agree with the venue (${hlChecked} checked, worst ${(hlWorst * 100).toFixed(2)}%)`);
}

const body = `/* GENERATED by scripts/generate-coins.mjs - DO NOT EDIT BY HAND.
 *
 * Every instrument both Bybit and Binance trade as a USDT perpetual, ranked by 24h turnover on
 * the THINNER of the two venues, plus the explicit single-venue instruments listed in the
 * generator. Regenerate with: node scripts/generate-coins.mjs
 *
 * \`mult\` converts an exchange price to the per-token price the app uses - 0.001 for the 1000x
 * memecoin listings. \`dec\` comes from the exchange tick size. \`oneVenue\` marks an instrument
 * with no failover.
 *
 * Generated: ${new Date().toISOString()}
 * Instruments: ${rows.length} (${rows.filter(r => r.oneVenue).length} single-venue)
 */

export interface CoinRow {
  readonly id: string;
  readonly bybit: string | null;
  readonly binance: string | null;
  /** Converts a BYBIT quote to the per-token price. */
  readonly bybitMult: number;
  /** Converts a BINANCE quote to the per-token price. The two differ on sats, toshi, tag, turbo. */
  readonly binanceMult: number;
  /** OKX instrument id, or null where OKX does not list it. NO MULTIPLIER: OKX quotes these per
   *  token, verified against the other two venues on every generation. */
  readonly okx: string | null;
  readonly dec: number;
  readonly oneVenue: boolean;
}

export const COIN_UNIVERSE: readonly CoinRow[] = [
${rows.map(r => `  { id: '${r.id}', bybit: ${r.bybit ? `'${r.bybit}'` : 'null'}, binance: ${r.binance ? `'${r.binance}'` : 'null'}, okx: ${r.okx ? `'${r.okx}'` : 'null'}, bybitMult: ${r.bybitMult}, binanceMult: ${r.binanceMult}, dec: ${r.dec}, oneVenue: ${r.oneVenue} },`).join('\n')}
];
`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  /* NORMALISE LINE ENDINGS BEFORE COMPARING. This is the SECOND reason this check could only
     ever return one answer, and the stable sort above - written to fix exactly that - does not
     reach it.

     `writeFileSync` emits LF. A Windows checkout with `core.autocrlf=true` converts on checkout,
     and `git check-attr eol` reports `unspecified` for this path, so the committed file carries
     491 CRLF and 0 bare LF while `body` has none. The comparison then failed on every line of a
     file whose content was identical, and printed STALE with nothing stale.

     THE COMMENT ABOVE WAS WRONG ON THE DAY IT MERGED, and that is the part worth keeping. #1933
     recorded that `--check` had stopped being a one-answer check; it had not, for a reason that
     measurement would have caught and reasoning did not. QA generated and diffed instead of
     trusting the claim - 463 rows both sides, 0 added, 0 removed, 0 changed, order identical -
     and found the comparison still failing. My own "before 1 / after 0" was measured seconds
     after a local regeneration, while the file on disk was still the LF one the script had just
     written. The reading was true and the inference from it was not.

     NORMALISED HERE RATHER THAN PINNED IN `.gitattributes`: a pin renormalises the file in its
     own diff, and would still leave this comparison depending on whoever runs it having the
     right git config. CI's config is not ours to assume. */
  const strip = s => s.replace(/\r\n/g, '\n').replace(/^ \* Generated: .*$/m, '');
  if (strip(current) === strip(body)) { console.log(`up to date: ${rows.length} instruments`); process.exit(0); }

  /* SAY WHAT DIFFERS, not only that something does. A bare STALE is what sent the last reader
     looking for a content change that was not there. The line counts and the first differing
     line separate "a venue listed a new instrument" from "this file was written by another
     tool" - two findings with nothing in common but the word STALE. */
  const a = strip(current).split('\n');
  const b = strip(body).split('\n');
  const firstDiff = a.findIndex((line, i) => line !== b[i]);
  const at = firstDiff === -1 ? Math.min(a.length, b.length) : firstDiff;
  console.error(`STALE: regenerate lib/coinUniverse.generated.ts (would be ${rows.length} instruments)`);
  console.error(`  committed ${a.length} lines, generated ${b.length}; first difference at line ${at + 1}:`);
  console.error(`    committed: ${JSON.stringify(a[at] ?? null)}`);
  console.error(`    generated: ${JSON.stringify(b[at] ?? null)}`);
  process.exit(1);
}

writeFileSync(OUT, body);
console.log(`wrote ${rows.length} instruments (${rows.filter(r => r.oneVenue).length} single-venue) to lib/coinUniverse.generated.ts`);
