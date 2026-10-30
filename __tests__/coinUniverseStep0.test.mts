/* STEP 0 FOR #1263: the coin list is now GENERATED from both exchanges - 50 instruments became 463 - and these are the
 * properties that must survive that, written before the change is tested anywhere else.
 *
 * WHY STEP 0 AND NOT A LATER CHECK. Every cell here is a property over the WHOLE universe rather than a sample, because
 * the thing that changed is the universe's size. A list that is typed can be eyeballed; a list that is generated cannot,
 * and the failures it admits are all of the same shape - one row disagreeing with the rule the rest follow, silently.
 * That is not hypothetical: `pepe` and `bonk` sat in the hand table recorded as Bybit-only for months, with no failover,
 * and generating the list is what found it. Reading the list never would have.
 *
 * WHERE THE EXPECTATIONS COME FROM. The product rules are read from their governing source, not from the code they
 * police: the signal ladder from `lib/signalCoinGate.ts`'s own header (owner, 2026-10-07; trial split 2026-10-20, #1596),
 * the failover rule from `lib/coins.ts`'s header and `lib/klinesFailover.ts` (Bybit default, Binance failover), and the
 * heatmap's bucket rule from the PR that introduced `other`. Where a number is genuinely the generator's to choose - how
 * many coins, which ones - this file asserts the INVARIANT and not the number, so a regeneration that adds listings does
 * not fail it and a regeneration that breaks the rule does.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: nothing here renders a page. Whether the heatmap's new "Other" tab
 * is visible, whether BTC at one decimal looks deliberate, and whether a coin from outside the old 50 loads candles are
 * all page-level questions on a deployed build, and three of them are the owner's to judge. This file proves the data
 * and the wiring behind them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COINS, SCANNED_COINS, SCAN_LIMIT, BINANCE_SYMS, BYBIT_SYMS, BINANCE_SYM_TO_COIN,
  COIN_DEC, COIN_LABELS, coinRow, isSingleVenue, bybitPriceFactor, bybitSymbolPriceFactor, chartDisplaySymbol,
} from '../lib/coins.ts';
import { COIN_UNIVERSE } from '../lib/coinUniverse.generated.ts';
import {
  FREE_SIGNAL_COINS, SIGNED_OUT_SIGNAL_COINS, signalsAllowedFor, coinLockedForUnpaid, aiCoinAllowed, normalizeCoinId,
} from '../lib/signalCoinGate.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');

/* The shapes a coin id must never take. A generated list is only as safe as what it refuses to contain, and each of
 * these has a surface that would accept it quietly - a pair symbol reaches the AI gate as a coin name, and an exchange
 * symbol is what a copy-paste from a chart produces. */
const MALFORMED = ['BTC/USDT', 'btc/usdt', 'BTCUSDT', 'btc:usdt', 'not-a-coin', ''] as const;

/* NOT malformed, and the distinction cost a cell: `normalizeCoinId` trims and lower-cases BY DESIGN, so these are all
 * the coin `btc` and must be ALLOWED for a Free account. The header says why - ' XRP ' and 'Xrp' have to be the same
 * locked coin, or case is a way round the list. My first version of S5 asserted these were refused, which would have
 * pinned a bug as the expectation. */
const SAME_COIN_AS_BTC = ['BTC', ' btc', ' BTC ', 'Btc'] as const;

/* THE UNIT PREFIXES EITHER VENUE ACTUALLY USES. Both quote some low-unit-price tokens per 1000, 10,000 or 1,000,000,
 * and that prefix is a QUANTITY. It is not the same thing as a leading digit in a token's NAME - `0G`, `2Z`, `1INCH`
 * and `4` are tickers, not quantities - and conflating the two is the defect S11 and S11b exist to catch. */
const UNIT_PREFIXES = [1_000_000, 10_000, 1_000] as const;
const unitPrefix = (sym: string): number => UNIT_PREFIXES.find(n => sym.startsWith(String(n))) ?? 1;

/* ── 1. THE SIGNAL LADDER DOES NOT WIDEN WITH THE LIST ───────────────────────────────────────────────────────────────
 *
 * The owner's rule is three coins for anyone who has not paid, and it is written as two lists in signalCoinGate.ts. The
 * risk this release creates is not that someone edits those lists - it is that growing the universe nine-fold changes
 * what "every other coin" means, and nothing here was ever exercised against more than 47 of them. */

test('S1. the Free/trial list is exactly BTC, ETH, SOL and the signed-out list exactly BTC, at any universe size', () => {
  assert.deepEqual([...FREE_SIGNAL_COINS], ['btc', 'eth', 'sol']);
  assert.deepEqual([...SIGNED_OUT_SIGNAL_COINS], ['btc']);

  /* The list grew, which is the premise of every cell below. Asserted as a floor rather than as 463: the count is the
   * generator's to decide and a new listing must not fail this file. A regeneration that collapsed back to the old
   * hand-written breadth WOULD fail it, and that is the case worth catching - it would make every "at 463" claim in
   * this file vacuous while leaving it green. */
  assert.ok(COINS.length > SCAN_LIMIT * 4, `expected a generated-size universe, got ${COINS.length}`);
});

test('S2. every coin outside the Free list is locked for Free AND trial - checked over the whole universe, not a sample', () => {
  const free = new Set<string>(FREE_SIGNAL_COINS);
  let locked = 0;
  for (const c of COINS) {
    if (free.has(c)) {
      assert.equal(signalsAllowedFor('free', c), true, `${c} is on the Free list and must be allowed`);
      assert.equal(signalsAllowedFor('trial', c), true, `${c} is on the Free list and must be allowed`);
      assert.equal(coinLockedForUnpaid('free', c), false, `${c} must not read as locked`);
      continue;
    }
    assert.equal(signalsAllowedFor('free', c), false, `${c} must be locked for Free`);
    assert.equal(signalsAllowedFor('trial', c), false, `${c} must be locked for a TRIAL too - a trial is not paid Pro here`);
    assert.equal(coinLockedForUnpaid('trial', c), true, `${c} must show the lock line for a trial`);
    locked += 1;
  }
  assert.equal(locked, COINS.length - free.size);
  assert.ok(locked > 400, `only ${locked} coins were checked as locked - the universe did not grow`);
});

test('S3. paid Pro gets every coin, and signed-out gets BTC only, over the whole universe', () => {
  for (const c of COINS) {
    assert.equal(signalsAllowedFor('pro', c), true, `Pro must see ${c}`);
    assert.equal(signalsAllowedFor('signed_out', c), c === 'btc', `signed-out ladder changed for ${c}`);
  }
});

test('S4. the Free list is a SUBSET of what this build serves - a free coin that is not in the universe locks everyone out', () => {
  /* Not a formality. The two lists are hand-written and the universe is generated, so they can drift in the one
   * direction that is invisible: if `sol` were ever dropped from the generated list, `signalsAllowedFor` would keep
   * returning true for it while no chart, symbol or decimal existed - a coin that is allowed and unserveable. */
  for (const c of [...FREE_SIGNAL_COINS, ...SIGNED_OUT_SIGNAL_COINS]) {
    assert.notEqual(coinRow(c), undefined, `${c} is on a tier list but not in the generated universe`);
    assert.ok(BYBIT_SYMS[c] || BINANCE_SYMS[c], `${c} is on a tier list with no exchange symbol at all`);
  }
});

test('S5. the AI gate refuses every non-Free coin for free and trial, and K1: `pro` short-circuits BEFORE the coin is read', () => {
  const free = new Set<string>(FREE_SIGNAL_COINS);
  for (const c of COINS) {
    assert.equal(aiCoinAllowed('free', c), free.has(c), `aiCoinAllowed('free', '${c}')`);
    assert.equal(aiCoinAllowed('trial', c), free.has(c), `aiCoinAllowed('trial', '${c}')`);
  }

  /* K1, PINNED AS A KNOWN LIMIT so that a change to it fails here rather than passing unnoticed. `aiCoinAllowed`
   * returns true for `pro` on line 1, before `normalizeCoinId` is called at all - so it answers true for a coin that
   * does not exist, for a pair symbol, and for junk. That is defensible (Pro is allowed every coin, and a nonexistent
   * coin fails later on its own) but it has one consequence worth writing down: **a Pro test account cannot detect a
   * coin-gate bug.** Any future test of this gate must run as free or trial. */
  for (const bad of [...MALFORMED, 'not-a-coin', '', null, undefined, 42, {}]) {
    assert.equal(aiCoinAllowed('pro', bad as unknown), true, 'K1 changed: pro no longer short-circuits');
  }
  for (const bad of MALFORMED) {
    assert.equal(aiCoinAllowed('free', bad), false, `a malformed id must not pass the gate: ${JSON.stringify(bad)}`);
  }
  /* And the other half of the same rule: case and padding are NORMALISED, not refused, so these are the coin `btc` and
   * a Free account is entitled to them. A test that refused them would pin a bug as the expectation. */
  for (const same of SAME_COIN_AS_BTC) {
    assert.equal(aiCoinAllowed('free', same), true, `${JSON.stringify(same)} is 'btc' after normalisation and must be allowed`);
    assert.equal(normalizeCoinId(same), 'btc');
  }
  /* And the normaliser's own contract, which is what makes ' btc ' and 'Xrp' the same locked coin rather than a way
   * round the list. It lower-cases and trims; it does NOT validate, so a pair symbol survives it as a string and is
   * refused by the LIST, not by the parse. Both halves matter and the second is the one people assume wrongly. */
  assert.equal(normalizeCoinId(' BTC '), 'btc');
  assert.equal(normalizeCoinId('BTC/USDT'), 'btc/usdt');
  assert.equal(normalizeCoinId(''), null);
  assert.equal(normalizeCoinId(42), null);
});

/* ── 2. THE FAILOVER GUARANTEE, AS A PROPERTY OVER ALL 463 ───────────────────────────────────────────────────────────
 *
 * `lib/coins.ts`: an instrument qualifies when BOTH venues trade it, because Bybit is the default read and Binance the
 * failover. Two instruments are kept deliberately without a second venue and marked `oneVenue`.
 *
 * So `oneVenue` is not decoration - it is the only way a caller can ask whether a failover exists instead of finding
 * out during an outage. A row with `oneVenue: false` and a missing symbol is exactly the pepe/bonk defect in the other
 * direction, and it would be just as silent. */

test('S6. oneVenue is TRUE if and only if a symbol is missing - no row claims a failover it does not have', () => {
  const singles: string[] = [];
  for (const r of COIN_UNIVERSE) {
    const bothVenues = Boolean(r.bybit) && Boolean(r.binance);
    assert.equal(
      r.oneVenue, !bothVenues,
      `${r.id}: oneVenue=${r.oneVenue} but bybit=${JSON.stringify(r.bybit)} binance=${JSON.stringify(r.binance)}`,
    );
    assert.equal(isSingleVenue(r.id), !bothVenues, `isSingleVenue('${r.id}') disagrees with the row`);
    if (!bothVenues) {
      assert.ok(r.bybit || r.binance, `${r.id} has NO venue at all - it cannot be served`);
      singles.push(r.id);
    }
  }
  /* The exceptions are deliberate and few. A floor is wrong here and a cap is right: this is the one property where
   * growth is the defect - a regeneration that quietly admitted dozens of single-venue instruments would be dropping
   * the failover guarantee for all of them. */
  assert.ok(singles.length <= 4, `${singles.length} single-venue instruments: ${singles.join(', ')} - the failover rule is slipping`);
});

test('S7. an unflagged coin can actually be read from both venues, and the reverse symbol map round-trips', () => {
  for (const c of COINS) {
    if (isSingleVenue(c)) continue;
    assert.ok(BYBIT_SYMS[c], `${c} claims a failover but has no Bybit symbol`);
    assert.ok(BINANCE_SYMS[c], `${c} claims a failover but has no Binance symbol`);
    assert.equal(BINANCE_SYM_TO_COIN[BINANCE_SYMS[c]], c, `${BINANCE_SYMS[c]} does not map back to ${c}`);
  }
  /* The reverse map must not collide: two coins sharing one Binance symbol would make a server-side failover route
   * serve the wrong instrument's candles, which is unreadable from the data and visible only as a wrong chart. */
  assert.equal(Object.keys(BINANCE_SYM_TO_COIN).length, Object.keys(BINANCE_SYMS).length, 'two coins share one Binance symbol');
});

test('S8. every coin has the four things a surface needs: an id, a decimal count, a label and at least one symbol', () => {
  const seen = new Set<string>();
  for (const c of COINS) {
    assert.equal(seen.has(c), false, `duplicate id in the universe: ${c}`);
    seen.add(c);
    assert.equal(typeof COIN_DEC[c], 'number', `${c} has no decimal count`);
    assert.ok(Number.isInteger(COIN_DEC[c]) && COIN_DEC[c] >= 0 && COIN_DEC[c] <= 12, `${c}: implausible decimals ${COIN_DEC[c]}`);
    assert.equal(COIN_LABELS[c], c.toUpperCase(), `${c}'s label is not its ticker`);
    assert.ok(BYBIT_SYMS[c] || BINANCE_SYMS[c], `${c} has no symbol on either venue`);
  }
});

/* ── 3. WHAT THE UNIVERSE MUST REFUSE TO CONTAIN ─────────────────────────────────────────────────────────────────────
 *
 * A pair symbol reaching a coin field is the shape this project has actually shipped wrong before, which is why
 * `arenaCoinLadder` already refuses six of them at the gate. The question HERE is upstream of the gate: the generated
 * list itself must not contain an id of that shape, because an id in the list is served - chart, symbol, decimals and
 * all - and every refusal downstream is then arguing with its own data. */

test('S9. no id in the generated universe is a pair symbol, an exchange symbol, upper-case or padded', () => {
  for (const c of COINS) {
    assert.match(c, /^[a-z0-9]+$/, `id '${c}' is not a bare lower-case ticker`);
    assert.equal(c.includes('/'), false, `id '${c}' is pair-shaped`);
    assert.equal(c.trim(), c, `id '${c}' has whitespace`);
    assert.equal(c.toLowerCase(), c, `id '${c}' is not lower-case`);
    assert.equal(/usdt$/.test(c), false, `id '${c}' looks like an exchange symbol, not a coin`);
  }
});

test('S10. a malformed or unknown id returns SAFE DEFAULTS everywhere rather than throwing or guessing', () => {
  for (const bad of [...MALFORMED, 'not-a-coin', 'zzzz']) {
    assert.equal(coinRow(bad), undefined, `coinRow('${bad}') must be undefined`);
    assert.equal(isSingleVenue(bad), false, `isSingleVenue('${bad}') must default to false, not throw`);
    assert.equal(COIN_DEC[bad], undefined, `COIN_DEC['${bad}'] must be undefined`);
    assert.equal(BYBIT_SYMS[bad], undefined, `BYBIT_SYMS['${bad}'] must be undefined`);
    /* 1 rather than 0: a wrong factor of 0 would print every price as zero, a wrong factor of 1000 would print one a
     * thousand times too big. The unknown-id default has to be the identity. */
    assert.equal(bybitPriceFactor(bad), 1, `bybitPriceFactor('${bad}') must default to 1`);
  }
});

/* ── 4. THE 1000x TRAP, DERIVED RATHER THAN INLINED ──────────────────────────────────────────────────────────────────
 *
 * Bybit quotes the low-unit-price memes per 1000 tokens, so any price read from `1000PEPEUSDT` is 1000x the per-token
 * price the rest of the app uses. This was an inline `startsWith('1000')` in two places and MISSING in a third, which
 * recorded PEPE and BONK alert outcomes at ±100,000% and dragged the Track Record's average 24h move to -126% against
 * a real median of +0.28%.
 *
 * It is now carried in the generated row. The property below is what makes that safe: a new 1000x listing cannot
 * arrive without its factor, because the factor is checked against the symbol rather than against a list of the memes
 * anyone remembered. */

test('S11. every multiplier is a real unit conversion - finite, positive, and one the venues actually quote', () => {
  /* THE CELL THAT FOUND TWO DEFECTS, and the first version of it was wrong in an instructive way: it read ANY leading
   * digits as a quantity, exactly as the generator does, so it agreed with the generator about `0G` and `2Z` and
   * disagreed with it about `4USDT`. A test that re-implements the rule under test can only find where the two copies
   * drift - not where the rule itself is wrong. This version asserts what a multiplier MEANS instead: a price divided
   * by a unit count the exchange actually quotes in. */
  /* EVERY offending row is collected rather than asserted one at a time, because the first version failed on `z` and
   * the message named one coin - while `g` was also wrong, in a worse way. "Which rows" is the finding here; a cell
   * that stops at the first one understates it. */
  const allowed = [1, ...UNIT_PREFIXES.map(n => 1 / n)];
  const offenders: string[] = [];
  let multiplied = 0;
  for (const r of COIN_UNIVERSE) {
    const sym = r.bybit ?? r.binance ?? '';
    const expected = 1 / unitPrefix(sym);
    if (!Number.isFinite(r.mult) || r.mult <= 0) {
      offenders.push(`${r.id} (${sym}): mult=${r.mult} - EVERY price for this coin becomes ${r.mult}`);
    } else if (!allowed.includes(r.mult)) {
      offenders.push(`${r.id} (${sym}): mult=${r.mult} is not a unit either venue quotes in`);
    } else if (r.mult !== expected) {
      offenders.push(`${r.id} (${sym}): mult=${r.mult}, its quoted unit is ${expected}`);
    } else {
      assert.equal(bybitPriceFactor(r.id), expected, `bybitPriceFactor('${r.id}')`);
      if (expected !== 1) multiplied += 1;
    }
  }
  assert.deepEqual(offenders, [], `multipliers that are not unit conversions:\n  ${offenders.join('\n  ')}`);
  /* The control for this cell: if the universe contained no 1000x listing at all, every assertion above would hold
   * vacuously and this cell would prove nothing. It must find some. */
  assert.ok(multiplied >= 2, `found ${multiplied} multiplied listings - this cell needs at least pepe and bonk to mean anything`);
  assert.equal(bybitPriceFactor('pepe'), 0.001);
  assert.equal(bybitPriceFactor('bonk'), 0.001);
  assert.equal(bybitPriceFactor('btc'), 1);
  assert.equal(bybitSymbolPriceFactor('1000PEPEUSDT'), 0.001);
  assert.equal(bybitSymbolPriceFactor('BTCUSDT'), 1);
});

test('S11b. the id is the ticker, not the ticker with its leading digits eaten', () => {
  /* `0G`, `2Z`, `1INCH` and `4` are token NAMES that begin with a digit. The generator's `normaliseBase` reads any
   * leading digits as a unit count, so it produced ids `g`, `z` and `inch` - and `COIN_LABELS` is `id.toUpperCase()`,
   * so those render as `G`, `Z` and `INCH` in the ticker and as `G/USDT` on the chart. `4USDT` escaped only because
   * the pattern needs at least one character after the digits.
   *
   * This is the same root cause as S11 seen from the other side: one rule is being asked to distinguish a quantity
   * from a name, and it cannot. Only a KNOWN unit prefix may be stripped. */
  const wrong: string[] = [];
  for (const r of COIN_UNIVERSE) {
    const sym = (r.bybit ?? r.binance ?? '').replace(/USDT$/, '');
    const prefix = unitPrefix(sym);
    const expected = (prefix === 1 ? sym : sym.slice(String(prefix).length)).toLowerCase();
    if (r.id !== expected) {
      wrong.push(`id '${r.id}' came from '${sym}' - the ticker is '${expected}', and it renders as '${r.id.toUpperCase()}'`);
      continue;
    }
    assert.equal(COIN_LABELS[r.id], expected.toUpperCase(), `${r.id}'s displayed ticker`);
  }
  assert.deepEqual(wrong, [], `ids that are not their ticker:\n  ${wrong.join('\n  ')}`);
});

test('S11c. both venues quote a coin in the SAME unit, or one multiplier cannot describe both', () => {
  /* `mult` is one number per row, taken from Bybit (`generate-coins.mjs`: "Bybit is the price source"). That is only
   * safe while Binance quotes the same coin in the same unit. Where they differ, any read of the Binance symbol - or a
   * failover that returns per-token data under a per-1000 symbol - is out by the ratio, silently, which is the
   * ±100,000% class of defect this release set out to remove.
   *
   * Measured today: `sats` is Bybit `10000SATS` against Binance `1000SATS`, a factor of 10 between the two. The three
   * others that differ (`toshi`, `tag`, `turbo`) have no Binance prefix at all, so the Bybit multiplier happens to be
   * the right conversion in the one direction `app/api/market/klines/route.ts:442` implements - they are not safe by
   * design, only by luck of direction. The assertion covers both. */
  const offenders: string[] = [];
  for (const r of COIN_UNIVERSE) {
    if (!r.bybit || !r.binance) continue;
    const a = unitPrefix(r.bybit), b = unitPrefix(r.binance);
    if (a !== b) offenders.push(`${r.id}: bybit=${r.bybit} (per ${a}) vs binance=${r.binance} (per ${b}), row mult=${r.mult}`);
  }
  assert.deepEqual(offenders, [], `the two venues disagree on the unit for these coins, and the row carries only one multiplier:\n  ${offenders.join('\n  ')}`);
});

test('S12. the chart label says 1000x when the series is 1000x, and does not when it is not', () => {
  assert.equal(chartDisplaySymbol('pepe'), '1000PEPE/USDT');
  assert.equal(chartDisplaySymbol('bonk'), '1000BONK/USDT');
  assert.equal(chartDisplaySymbol('btc'), 'BTC/USDT');
  /* The invariant behind those three, over the whole universe: the label carries the 1000 prefix exactly when the
   * Bybit symbol does. The label is the only thing that tells a user the series is per-thousand. */
  for (const c of COINS) {
    const prefixed = Boolean(BYBIT_SYMS[c]?.startsWith('1000'));
    assert.equal(chartDisplaySymbol(c).startsWith('1000'), prefixed, `${c}: chart label disagrees with its symbol`);
  }
});

/* ── 5. THE SCAN'S BREADTH IS NOT THE PRODUCT'S BREADTH ──────────────────────────────────────────────────────────────
 *
 * The alert cron fetches 300 klines per coin per run, so the list's length WAS the scan's cost. The release separates
 * them: the product gets 463 and the scan stays at 50. If anything re-pointed the cron at `COINS`, the exchange calls
 * would multiply by nine and the first symptom would be a rate-limit ban on the shared egress IP - not a test failure.
 * Hence a source-level check as well as a data one. */

test('S13. SCANNED_COINS is the liquidity-ranked top 50 and a true prefix of the universe', () => {
  assert.equal(SCAN_LIMIT, 50);
  assert.equal(SCANNED_COINS.length, SCAN_LIMIT);
  assert.deepEqual(SCANNED_COINS, COINS.slice(0, SCAN_LIMIT));
  assert.ok(COINS.length > SCANNED_COINS.length, 'the scan must be a strict subset, or this separation does nothing');
  for (const c of FREE_SIGNAL_COINS) {
    assert.ok(SCANNED_COINS.includes(c), `${c} is a Free coin and must be inside the scanned set`);
  }
});

test('S14. the alert cron and the funding route iterate SCANNED_COINS, never the full list', () => {
  for (const rel of ['app/api/telegram/alert/route.ts', 'app/api/funding/route.ts']) {
    const src = read(rel);
    /* `COINS.map(`/`COINS.filter(` etc. is the shape that made the length the cost. `SCANNED_COINS` is a different
     * identifier, so a word boundary is enough to tell them apart - and the assertion names the file so a failure
     * reads as "this route went back to the full list" rather than as a regex puzzle. */
    const fullList = src.match(/(?<![A-Z_])COINS\s*\.\s*(map|filter|forEach|slice|flatMap)\b/g) ?? [];
    assert.deepEqual(fullList, [], `${rel} iterates the FULL coin list: ${fullList.join(', ')}`);
    assert.match(src, /SCANNED_COINS/, `${rel} does not reference SCANNED_COINS at all`);
  }
});

/* ── 6. THE HEATMAP'S BUCKETS: EVERY COIN REACHABLE IN EXACTLY ONE FILTERED VIEW ─────────────────────────────────────
 *
 * The four sector buckets are editorial and cannot be derived - neither venue publishes a sector, so there is nothing
 * to compute "meme" or "DeFi" from. They name about 50 coins out of 463, and `other` is derived to hold the rest.
 *
 * READ FROM SOURCE, AND SAYING WHY. `CAT` and `CURATED` are module-private to `components/CoinHeatmap.tsx` - the
 * component is the only consumer and exporting them for a test would be changing app code to suit a test, which is not
 * QA's to do. So this parses the four literal lists out of the file and checks them against the REAL `COINS` imported
 * above. The expectations are the PR's stated rule, not a re-implementation of the component: if these cells were
 * written by re-deriving `other` the same way the component does, they could not disagree with it, and a test that
 * cannot disagree with the thing it tests measures nothing. */

const HEATMAP = read('components/CoinHeatmap.tsx');

function curatedBuckets(): Record<string, string[]> {
  /* The type annotation contains its own `>` - `Record<Exclude<Cat, 'all' | 'other'>, readonly CoinId[]>` - so a
   * `[^>]*` match stops inside it and finds nothing. S15 exists because that is exactly what my first version did,
   * and four cells went green-looking-red for a regex reason rather than a product one. */
  const block = /const CURATED:[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(HEATMAP);
  assert.notEqual(block, null, 'CURATED was not found in CoinHeatmap.tsx - the bucket structure changed, re-read the file');
  const out: Record<string, string[]> = {};
  for (const m of block![1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
  }
  return out;
}

test('S15. the parse itself found something - the control for every cell below it', () => {
  const buckets = curatedBuckets();
  assert.deepEqual(Object.keys(buckets).sort(), ['alts', 'defi', 'majors', 'meme']);
  for (const [name, ids] of Object.entries(buckets)) {
    assert.ok(ids.length >= 5, `bucket '${name}' parsed as ${ids.length} coins - the regex is matching the wrong thing`);
  }
});

test('S16. every curated coin still exists in the generated universe - an editorial list can name a delisted coin', () => {
  /* The failure this catches: a curated id that the exchanges no longer trade renders as a named sector tab with a
   * missing cell, and nothing in the data says the id is stale. It is the one way the editorial half can rot while the
   * generated half stays correct. */
  for (const [name, ids] of Object.entries(curatedBuckets())) {
    for (const id of ids) {
      assert.notEqual(coinRow(id), undefined, `'${id}' is curated into '${name}' but is not in the universe`);
    }
  }
});

test('S17. no coin is in two sector buckets', () => {
  const where = new Map<string, string>();
  for (const [name, ids] of Object.entries(curatedBuckets())) {
    for (const id of ids) {
      assert.equal(where.get(id), undefined, `'${id}' is in both '${where.get(id)}' and '${name}'`);
      where.set(id, name);
    }
  }
});

test('S18. `other` is DERIVED from COINS, not a hand-written list that can fall behind it', () => {
  /* The distinction is the whole point of the bucket. A literal `other: ['...']` would reintroduce exactly the failure
   * it exists to prevent - a tradable coin shown under All, absent from every filtered view, with nothing saying so -
   * and it would look correct on the day it was written. */
  assert.match(
    HEATMAP,
    /other:\s*COINS\.filter\(\s*c\s*=>\s*!CURATED_IDS\.has\(c\)\s*\)/,
    '`other` is no longer derived from COINS - a hand-written bucket cannot keep up with a generated list',
  );
  assert.match(HEATMAP, /type Cat =[^;]*\bother\b/, "'other' is missing from the Cat union, so the tab cannot be selected");
  assert.match(HEATMAP, /other:\s*t\('COIN_HEATMAP_CAT_OTHER'\)/, "the 'other' tab has no label, so it would render blank or bare");
});

test('S19. the four buckets plus `other` cover the whole universe, and `other` is the big half', () => {
  const curated = new Set(Object.values(curatedBuckets()).flat());
  const other = COINS.filter(c => !curated.has(c));
  /* Coverage, which is the property the owner would notice if it broke: nothing tradable is invisible. */
  for (const c of COINS) {
    const inCurated = curated.has(c);
    const inOther = other.includes(c);
    assert.notEqual(inCurated && inOther, true, `${c} is in a sector bucket AND in other`);
    assert.ok(inCurated || inOther, `${c} is tradable but in no filtered view at all`);
  }
  assert.equal(curated.size + other.length, COINS.length);
  /* And the reason the bucket had to be added at all, as a number: the curated lists name a small minority now. If
   * `other` were ever nearly empty, the buckets would have been extended by hand after all - worth knowing. */
  assert.ok(other.length > curated.size, `other=${other.length} vs curated=${curated.size} - the derived bucket is not holding the tail`);
});

test('S20. the new tab label exists as a KEY and as a default string, so no bare label key can reach the screen', () => {
  /* `lib/labelOverrides.ts` lets a database row win over the default, so a key that is missing from the defaults is not
   * a build error - it is a bare `COIN_HEATMAP_CAT_OTHER` rendered in the tab row on any build with no override row.
   * That is the exact shape the release regression greps the deployed pages for, and it is cheaper to catch here. */
  assert.match(read('lib/labelKeys.ts'), /COIN_HEATMAP_CAT_OTHER/, 'the label key is not declared in labelKeys.ts');
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const value = defaults['COIN_HEATMAP_CAT_OTHER'];
  assert.equal(typeof value, 'string', 'COIN_HEATMAP_CAT_OTHER has no English default');
  assert.ok(value.trim().length > 0, 'COIN_HEATMAP_CAT_OTHER is an empty string');
  assert.notEqual(value, 'COIN_HEATMAP_CAT_OTHER', 'the default is the key itself, which is what a blanked label looks like');
});
