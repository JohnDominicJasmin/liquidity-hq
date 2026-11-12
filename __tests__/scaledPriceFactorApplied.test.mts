/* THE SCALED-PRICE MULTIPLIER, AND WHETHER ANYTHING READS A SCALED PRICE WITHOUT APPLYING IT.
 *
 * WHY THIS EXISTS, in three measurements rather than a worry:
 *
 *   `binancePriceFactor` shipped                     ZERO call sites
 *   the universe price pass (#1855)                  one site did not use it
 *   after that fix                                   eleven sites
 *
 * The live effect of the third: MOG would have rendered at `0.0961` instead of `0.000000096` - a
 * million times wrong, on the page a user picks a coin from. The same class recorded PEPE and BONK
 * alert outcomes at ±100,000% and dragged the Alert Track Record's average 24h move to -126%
 * against a real median of +0.28%.
 *
 * **A fix that exists and is not applied everywhere is indistinguishable from no fix.** Three
 * instances in one night means the next one will not be caught by someone noticing.
 *
 * ── WHAT THIS CAN AND CANNOT DO, said first because the limit is the honest part ──────────────
 *
 * It is a SOURCE-LEVEL check. It can tell that a file reading a Bybit price knows the conversion
 * exists. **It cannot tell that the factor is applied to the right value, in the right direction,
 * on every path through that file.** A file that imports `bybitPriceFactor`, uses it on one of two
 * price reads and renders the other raw passes this and is still wrong.
 *
 * So it is a NEW-PATH detector, not a correctness proof: it fires when a file joins the set
 * without the conversion, which is exactly the eleventh-and-twelfth-call-site case above, and it
 * is silent about the inside of a file that already knows. Saying so here rather than letting the
 * name imply more.
 *
 * ── DERIVED, NEVER A HAND LIST ────────────────────────────────────────────────────────────────
 *
 * The scaled set comes from the symbol maps the app actually ships, so a thirteenth 1000x listing
 * is covered on the day it arrives. A hand list passes on exactly that day - which is the day it
 * is needed. The same applies to the file set: it is a scan, not a roster.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINANCE_SYMS, BYBIT_SYMS, bybitPriceFactor, binancePriceFactor, symbolDenominationFactor, chartDisplaySymbol } from '../lib/coins.ts';
import { COIN_UNIVERSE } from '../lib/coinUniverse.generated.ts';
/* The whole module, for a function that exists on some trees and not others - a named import of
   `binancePriceFactor` would fail to COMPILE where the generated universe has not landed. */
import * as COINS_MOD from '../lib/coins.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The unit prefixes either venue actually quotes in. A leading digit in a token NAME - `0G`,
 *  `2Z`, `1INCH`, `4` - is a ticker, not a quantity, and conflating the two is its own defect. */
const UNIT_PREFIXES = [1_000_000, 10_000, 1_000] as const;
const unitPrefix = (sym: string): number => UNIT_PREFIXES.find(n => sym.startsWith(String(n))) ?? 1;

/** Every coin whose Bybit symbol is quoted per N tokens, derived from the shipped map. */
const SCALED = Object.entries(BYBIT_SYMS)
  .map(([coin, sym]) => ({ coin, sym, prefix: unitPrefix(sym) }))
  .filter(r => r.prefix !== 1);

/* ── 1. the numbers ───────────────────────────────────────────────────────────────────────────── */

test('M1. the scaled set is derived and NOT EMPTY - the control for everything below it', () => {
  /* With no scaled coin every assertion in this file holds vacuously, and the file would read as
     coverage while proving nothing. This is the cell that says so. */
  assert.ok(SCALED.length >= 2, `only ${SCALED.length} scaled symbols found in BYBIT_SYMS - the scan is broken, or the 1000x listings are gone`);
  /* Named, so a reader can see what the set actually is rather than trusting the count. */
  assert.ok(SCALED.some(r => r.coin === 'pepe'), `pepe is not in the scaled set: ${SCALED.map(r => r.sym).join(', ')}`);
});

test('M2. every scaled coin converts by exactly 1/prefix, and no unscaled coin converts at all', () => {
  for (const { coin, sym, prefix } of SCALED) {
    assert.equal(bybitPriceFactor(coin), 1 / prefix, `${coin} (${sym}) must convert by 1/${prefix}`);
  }
  for (const [coin, sym] of Object.entries(BYBIT_SYMS)) {
    if (unitPrefix(sym) !== 1) continue;
    assert.equal(bybitPriceFactor(coin), 1, `${coin} (${sym}) is quoted per token and must not be scaled`);
  }
});

test('M3. the symbol-only and coin-only conversions agree, for every coin', () => {
  /* Two functions answer the same question from different inputs - a coin id, and a bare symbol
     from a feed where the id is not in hand. They are used in different places, so they are
     exactly the pair that can drift apart without anything noticing. */
  for (const [coin, sym] of Object.entries(BYBIT_SYMS)) {
    assert.equal(
      symbolDenominationFactor(sym), bybitPriceFactor(coin),
      `${sym}: symbolDenominationFactor=${symbolDenominationFactor(sym)} but bybitPriceFactor('${coin}')=${bybitPriceFactor(coin)}`,
    );
  }
});

/* ── 1b. THE SAME PARITY, OVER THE WHOLE UNIVERSE ─────────────────────────────────────────────────
 *
 * M3 is the right check with the wrong domain, and that gap shipped a real defect (#2129).
 *
 * It iterates `Object.entries(BYBIT_SYMS)` - the editorial 50 - so the ~413 universe coins were
 * never compared. `symbolDenominationFactor` read `1 / Number(m[1])` for ANY leading digits, which
 * made `0GUSDT` return `Infinity`, `2ZUSDT` 0.5 and `4USDT` 0.25. Harmless only while nothing
 * resolved those symbols; #1263's client resolver reached them, and the consequence would have been
 * a signal's entry, stop and target wrong by 2x or 4x, or NaN - silently, and plausibly.
 *
 * THE COMMENT ON `UNIT_PREFIXES` ABOVE ALREADY NAMED THIS EXACT TRAP - "a leading digit in a token
 * NAME - 0G, 2Z, 1INCH, 4 - is a ticker, not a quantity, and conflating the two is its own defect".
 * The knowledge was in the file and the coverage was not, because the loop below it could not see
 * those coins. These cells close that, and the generated universe is the right domain for a parser
 * that takes a bare symbol from a feed: the feed is not limited to the coins we render.
 */

test('M8. the symbol parser agrees with the generator row, for every coin in the UNIVERSE', () => {
  const withBybit = COIN_UNIVERSE.filter(r => r.bybit);

  /* CONTROLS, both needed. The first: an empty or truncated universe makes every assertion below
     hold vacuously. The second: the three leading-digit tickers must actually be IN the set being
     checked - they are the regression this cell exists for, and a domain that excluded them would
     be M3's bug again under a new name. */
  assert.ok(withBybit.length > 400, `only ${withBybit.length} universe rows carry a Bybit symbol - the import is wrong or the file is truncated`);
  for (const id of ['0g', '2z', '4']) {
    assert.ok(withBybit.some(r => r.id === id), `'${id}' is missing from the checked set - without it this cell cannot see the defect it was written for`);
  }

  for (const row of withBybit) {
    assert.equal(
      symbolDenominationFactor(row.bybit as string), row.bybitMult,
      `BYBIT column: ${row.id} (${row.bybit}): parser says ${symbolDenominationFactor(row.bybit as string)}, the generated row says ${row.bybitMult}`,
    );
    /* And the coin-id form, which reads the row directly - so this pins all three answers together
       rather than letting two of them agree while the third drifts. */
    assert.equal(bybitPriceFactor(row.id), row.bybitMult, `bybitPriceFactor('${row.id}') disagrees with its own row`);
  }

  /* THE BINANCE COLUMN, which #2133 made a live path for this function and this cell did not cover.
   *
   * Three call sites now hand it a BINANCE symbol - `useEMAStrategy`, `backtestEngine` and the
   * higher-timeframe badge - because the function reads the symbol string rather than the venue. So
   * the bybit loop above was the same shape of gap M3 had, one column over: the right assertion over
   * an incomplete domain.
   *
   * FOUR COINS ARE THE WHOLE REASON THIS IS NOT REDUNDANT. The venues denominate these differently,
   * so a column-blind check passes while a venue-keyed implementation would be wrong:
   *
   *   sats   10000SATSUSDT  0.0001  |  1000SATSUSDT  0.001
   *   tag    1000TAGUSDT    0.001   |  TAGUSDT       1
   *   toshi  1000TOSHIUSDT  0.001   |  TOSHIUSDT     1
   *   turbo  1000TURBOUSDT  0.001   |  TURBOUSDT     1
   */
  const withBinance = COIN_UNIVERSE.filter(r => r.binance);
  assert.ok(withBinance.length > 400, `only ${withBinance.length} universe rows carry a Binance symbol - the import is wrong or the file is truncated`);

  /* CONTROL: the four coins whose venues DISAGREE must be in this set, and must actually disagree in
     the generated data. If they ever stop disagreeing, this loop still passes but has stopped testing
     anything that the bybit loop above does not already cover - so the cell says so rather than
     quietly becoming a duplicate. */
  const disagree = withBinance.filter(r => r.bybit && r.bybitMult !== r.binanceMult).map(r => r.id);
  assert.deepEqual(disagree.sort(), ['sats', 'tag', 'toshi', 'turbo'],
    `expected exactly sats/tag/toshi/turbo to denominate differently per venue, got [${disagree.join(', ')}] - `
    + 'if the universe changed, re-derive which coins make this cell worth having');

  for (const row of withBinance) {
    assert.equal(
      symbolDenominationFactor(row.binance as string), row.binanceMult,
      `BINANCE column: ${row.id} (${row.binance}): parser says ${symbolDenominationFactor(row.binance as string)}, the generated row says ${row.binanceMult}`,
    );
    assert.equal(binancePriceFactor(row.id), row.binanceMult, `binancePriceFactor('${row.id}') disagrees with its own row`);
  }
});

test('M9. a leading digit that is NOT a denomination does not scale the price', () => {
  /* Named individually rather than looped, because these three are the whole point: a ticker that
     happens to start with a digit. `1inch` is the fourth of the kind named in the comment above and
     is included for the same reason. */
  for (const id of ['0g', '2z', '4', '1inch']) {
    const row = COIN_UNIVERSE.find(r => r.id === id);
    assert.ok(row?.bybit, `control: '${id}' must exist with a Bybit symbol for this cell to mean anything`);
    assert.equal(symbolDenominationFactor(row!.bybit as string), 1,
      `${row!.bybit} is a token name beginning with a digit, not a 1000x listing - scaling it puts a live signal's entry, stop and target out by that factor`);
  }

  /* The real denominations must still scale, or "nothing scales" would pass this file. */
  assert.equal(symbolDenominationFactor('1000PEPEUSDT'), 0.001);
  assert.equal(symbolDenominationFactor('10000SATSUSDT'), 0.0001);
  assert.equal(symbolDenominationFactor('1000000MOGUSDT'), 0.000001);
});

test('M10. the renamed-away identifier appears nowhere in current source', () => {
  /* THE ARTIFACT THAT PROVES THE RENAME FINISHED (#2135 steps 1-4).
   *
   * While the deprecated alias was exported, a completed migration and one that had stalled with
   * call sites still on the old name were indistinguishable - everything compiled and everything
   * passed either way. The alias's deletion separated them, and this cell is what keeps them
   * separated: it fails if the alias is reintroduced, if a new call site adopts the old name, or if
   * someone restores the export for convenience.
   *
   * THE NEEDLE IS SPLIT SO THIS FILE CAN SCAN ITSELF. A cell that forbids a string has to contain
   * that string to search for it, and would then find itself. Excluding this file would have been
   * the easy fix and the wrong one: it is the file where the old name lived longest, so it is the
   * likeliest place for a leftover and the last place that should be exempt. */
  const OLD = 'bybitSymbol' + 'PriceFactor';

  /* GUARD ON THE TRICK ITSELF, composed a second way. A typo in the concatenation yields a needle
     that matches nothing and passes - and a search for the wrong string returns zero exactly like a
     finished migration does, which is the failure this whole cell exists to catch. */
  assert.equal(OLD.length, 22, `the split literal is the wrong length (${OLD.length}) - it has been mistyped`);
  assert.ok(OLD.startsWith('bybit') && OLD.endsWith('PriceFactor') && OLD.includes('Symbol'),
    `the split literal does not compose the expected identifier: got '${OLD}'`);

  /* `supabase/migrations` is EXCLUDED AS A CLASS, not as an exception: those files have already run
     against dev and prod, so they are applied history rather than current source. One of them
     mentions the old name in a comment describing what the code did at that commit, and editing it
     would make the record wrong to make this check clean. Noted on #1263 so nobody re-derives it. */
  const tracked = execFileSync('git', ['grep', '-l', '--', OLD], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
    .filter(p => !p.startsWith('supabase/migrations/'));

  /* POSITIVE CONTROL: the same command, same scope, for the name that replaced it. A zero from a
     `git grep` that cannot see this identifier at all looks exactly like a zero from a finished
     migration, and only this line tells them apart. */
  const current = execFileSync('git', ['grep', '-l', '--', 'symbolDenominationFactor'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
  assert.ok(current.length >= 5,
    `control: the replacement name was found in only ${current.length} files - git grep is not seeing `
    + 'identifiers here, so the empty result below would prove nothing');

  assert.deepEqual(tracked, [],
    `the renamed-away identifier still appears in current source: ${tracked.join(', ')}. Either a call `
    + 'site was missed, or the deprecated alias has been reintroduced - the rename is not finished.');
});

test('M4. the chart label carries the 1000 prefix exactly when the series does', () => {
  /* The label is the ONLY thing telling a user the chart is per-thousand. The chart is deliberately
     drawn on the exchange's scaled series - klinecharts collapses at very small values - so a
     missing prefix here is a chart silently claiming per-token prices. */
  for (const [coin, sym] of Object.entries(BYBIT_SYMS)) {
    const scaled = unitPrefix(sym) !== 1;
    assert.equal(
      chartDisplaySymbol(coin).startsWith(String(unitPrefix(sym))) === scaled, true,
      `${coin}: label "${chartDisplaySymbol(coin)}" disagrees with symbol "${sym}"`,
    );
  }
});

/* ── 2. the call sites ────────────────────────────────────────────────────────────────────────── */

/** Comments stripped FIRST, and that is not a detail: the first version of this scan fired on
 *  `lib/useOI1h.ts`, whose only mention of `markPrice` is a comment explaining why it does NOT
 *  read one. A scan that matches commentary reports the opposite of the truth. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A Bybit price field as the venue names them. */
const PRICE_FIELD = /\b(lastPrice|markPrice|indexPrice|prevPrice24h|highPrice24h|lowPrice24h)\b/;
/** Something that makes the value come FROM Bybit rather than being a parameter called price. */
const BYBIT_SOURCE = /\bBYBIT_SYMS\b|api\.bybit\.com|bybitFanout|type=bybit/;
/** The conversion, by any entry point.
 *
 * TIGHTENED TO THE CURRENT NAMES (#2135's rename, step 4b of four — the alias is gone).
 *
 * This is a pattern matched against OTHER FILES' source, not a reference to the function, so it has
 * to describe what the app code actually contains. For three steps of the rename that meant
 * accepting the old venue-named identifier as well, because the app still called it — and renaming
 * this pattern along with the imports is what broke this cell in the first draft of step 2: a
 * blanket identifier replace treats a scan pattern as if it were a call, when it is data about other
 * files. It did not fail cleanly either; it reported a missing conversion that was in fact present.
 *
 * The alternative is dropped here rather than earlier because the export's deletion is what makes it
 * safe: removing it while any app file still used the old name would bring that false finding back.
 * M10 below now asserts the old name appears nowhere, which is what keeps this pattern honest. */
const APPLIES_FACTOR = /\bbybitPriceFactor\b|\bsymbolDenominationFactor\b/;

/**
 * Files that read a Bybit price and deliberately do NOT convert, with the reason each is safe.
 *
 * An entry is a CONTRACT, not a waiver: it says the file hands the value on in the exchange's own
 * units and the consumer converts. If that stops being true the entry is a lie, and the only thing
 * standing behind it is the reason being written down where the next reader sees it.
 */
const FORWARDS_RAW: Readonly<Record<string, string>> = {
  'app/api/proxy/route.ts':
    'The proxy forwards exchange-native values unchanged - it maps Bybit ticker rows to a stable ' +
    'shape and passes lastPrice through as the venue sent it. Converting here would double-convert ' +
    'for every consumer that already does, and MarketProvider (its consumer for bybit-tickers) ' +
    'applies the factor. The contract is at the boundary: the proxy is a transport, not a reader.',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) { sourceFiles(rel, out); continue; }
    if (/\.(ts|tsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

test('M5. every file that reads a Bybit price applies the conversion, or says why it forwards it raw', () => {
  const scanned = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')];
  /* The scan must have found something to scan. A path typo would otherwise produce an empty set
     and a green cell - the shape of false pass this whole file exists to prevent. */
  assert.ok(scanned.length > 100, `only ${scanned.length} source files scanned - the walk is broken`);

  const inPricePath: string[] = [];
  const unconverted: string[] = [];
  for (const rel of scanned) {
    const src = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
    if (!PRICE_FIELD.test(src) || !BYBIT_SOURCE.test(src)) continue;
    inPricePath.push(rel);
    if (APPLIES_FACTOR.test(src)) continue;
    if (rel in FORWARDS_RAW) continue;
    unconverted.push(rel);
  }

  /* The set is printed on failure, because "which files" is the finding - a count is not actionable
     and a reader should not have to re-run the scan to see it. */
  assert.deepEqual(
    unconverted, [],
    'these files read a Bybit price and never mention the conversion:\n  ' + unconverted.join('\n  ') +
    '\n\nEither apply bybitPriceFactor/symbolDenominationFactor, or add the file to FORWARDS_RAW with ' +
    'the reason it is safe. A scaled symbol read raw is a price out by 1,000 to 1,000,000.' +
    `\n(files currently in the Bybit price path: ${inPricePath.join(', ')})`,
  );

  /* The other direction: an exemption for a file that no longer reads a Bybit price at all is dead
     weight, and dead weight in an exemption list is how a stale allowance outlives what it described. */
  const stale = Object.keys(FORWARDS_RAW).filter(f => !inPricePath.includes(f));
  assert.deepEqual(stale, [], `FORWARDS_RAW exempts ${stale.join(', ')}, which no longer reads a Bybit price. Remove the entry.`);

  /* And the scan must still be finding the path at all. If a refactor renamed the symbol map or the
     fields, this cell would go quietly green while covering nothing. */
  assert.ok(
    inPricePath.length >= 4,
    `only ${inPricePath.length} files matched the Bybit price path (${inPricePath.join(', ')}). ` +
    'There were 6 on 2026-10-31. A sharp drop means the patterns stopped matching, not that the ' +
    'code got safer - check PRICE_FIELD and BYBIT_SOURCE against how the app names things now.',
  );
});

/* ── 3. THE OTHER VENUE, WHICH THIS GUARD DID NOT COVER ───────────────────────────────────────────
 *
 * Dev found the gap and it is shaped like the defect that caused the guard: everything above names
 * only the Bybit side. The measurement that opens this file is `binancePriceFactor` shipping with
 * ZERO call sites - and that is still true, so **a guard that would not have caught its own
 * originating defect is not finished.**
 *
 * WHY NOTHING IS WRONG TODAY, AND WHY THAT IS NOT REASSURING. No shipped Binance symbol is scaled,
 * because a hold keeps `pepe` and `bonk` out of `BINANCE_SYMS`. **That hold is a one-line edit to a
 * `Set`, and the comment beside it invites exactly that edit.** The day it is lifted, Binance reads
 * of those two coins are 1000x wrong and everything above stays green.
 *
 * SO THE RULE IS WRITTEN AS A CONDITIONAL THAT IS NON-VACUOUS TODAY, which is the part worth
 * getting right: not "the Binance factor is applied" (nothing to apply it to yet, so it would hold
 * on an empty set forever) but **"a scaled Binance symbol may not ship without a converter that is
 * actually called"**. On a tree with no `binancePriceFactor` at all it reduces to "no scaled
 * Binance symbol may ship", which is checkable and true. On a tree that has one it demands call
 * sites. Either way it fires on the edit that would break it rather than on the day someone
 * notices a price. */

const COINS_SRC = readFileSync(path.join(ROOT, 'lib/coins.ts'), 'utf8');
/** Does this tree even have a Binance converter? It arrives with the generated universe. */
const HAS_BINANCE_FACTOR = /export function binancePriceFactor/.test(COINS_SRC);

test('M6. no shipped Binance symbol is scaled without a converter for it', () => {
  const scaledOnBinance = Object.entries(BINANCE_SYMS)
    .map(([coin, sym]) => ({ coin, sym, prefix: unitPrefix(sym) }))
    .filter(r => r.prefix !== 1);

  /* The scan must be looking at a real map, or "none are scaled" is a statement about nothing. */
  assert.ok(
    Object.keys(BINANCE_SYMS).length >= 20,
    `only ${Object.keys(BINANCE_SYMS).length} Binance symbols - the map is not populated, so this cell proves nothing`,
  );

  if (!HAS_BINANCE_FACTOR) {
    assert.deepEqual(
      scaledOnBinance.map(r => r.sym), [],
      'a scaled Binance symbol ships on a tree with NO binancePriceFactor, so nothing can convert it: ' +
      `${scaledOnBinance.map(r => `${r.coin}=${r.sym}`).join(', ')}`,
    );
    return;
  }

  /* With a converter present, every entry must agree with its own symbol - the Bybit rule, applied
     to the venue that was missing from it. */
  const mod = COINS_MOD as { binancePriceFactor?: (c: string) => number };
  const binanceFactor = mod.binancePriceFactor;
  /* `assert.ok` rather than `assert.equal`: it is typed `asserts value`, so it NARROWS the optional
     away for tsc. The equality form reads the same to a human and leaves the call site as
     "possibly undefined" - which the pre-push gate caught, correctly. */
  assert.ok(typeof binanceFactor === 'function', 'the source declares binancePriceFactor but the module does not export it');
  for (const [coin, sym] of Object.entries(BINANCE_SYMS)) {
    assert.equal(
      binanceFactor(coin), 1 / unitPrefix(sym),
      `${coin} (${sym}): the Binance factor disagrees with the symbol's own unit`,
    );
  }
});

test('M7. a scaled Bybit coin is kept off Binance by a HOLD, or its Binance factor has call sites', () => {
  /* THE CELL THAT FIRES ON THE ONE-LINE EDIT. For every coin quoted per N tokens on Bybit, exactly
     one of these must be true:
       - it is absent from BINANCE_SYMS (the hold, whatever the hold is called), or
       - it ships on Binance AND something outside lib/coins.ts actually calls the converter.
     The second arm is what `binancePriceFactor` having zero call sites means today, and why the
     first arm is the only thing standing between us and a 1000x Binance price. */
  const callSites = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]
    .filter(rel => rel !== 'lib/coins.ts')
    .filter(rel => /\bbinancePriceFactor\b/.test(stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))));

  const unprotected: string[] = [];
  for (const { coin, sym } of SCALED) {
    if (!BINANCE_SYMS[coin]) continue;                       // held off Binance - safe by absence
    if (callSites.length > 0) continue;                      // shipped, and something converts
    unprotected.push(`${coin} (bybit ${sym}, binance ${BINANCE_SYMS[coin]})`);
  }

  assert.deepEqual(
    unprotected, [],
    'these coins are scaled on Bybit AND ship on Binance while binancePriceFactor has NO call sites:\n  ' +
    unprotected.join('\n  ') +
    '\n\nEvery Binance read of them is out by their unit. Either keep them off BINANCE_SYMS, or give ' +
    'the converter call sites in the files that read a Binance price.',
  );

  /* AND THE STATE IS REPORTED EVEN WHEN IT PASSES, because "green" here currently means "protected
     by an absence" rather than "handled", and those are not the same thing to the next reader. */
  const heldOff = SCALED.filter(r => !BINANCE_SYMS[r.coin]).map(r => r.coin);
  assert.ok(
    heldOff.length > 0 || callSites.length > 0,
    'no scaled coin is held off Binance and the converter has no call sites - this cell has nothing ' +
    'to protect, which means either SCALED is empty (see M1) or the maps changed shape.',
  );
});
