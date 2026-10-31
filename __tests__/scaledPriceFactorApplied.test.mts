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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINANCE_SYMS, BYBIT_SYMS, bybitPriceFactor, bybitSymbolPriceFactor, chartDisplaySymbol } from '../lib/coins.ts';
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
      bybitSymbolPriceFactor(sym), bybitPriceFactor(coin),
      `${sym}: bybitSymbolPriceFactor=${bybitSymbolPriceFactor(sym)} but bybitPriceFactor('${coin}')=${bybitPriceFactor(coin)}`,
    );
  }
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
/** The conversion, by either entry point. */
const APPLIES_FACTOR = /\bbybitPriceFactor\b|\bbybitSymbolPriceFactor\b/;

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
    '\n\nEither apply bybitPriceFactor/bybitSymbolPriceFactor, or add the file to FORWARDS_RAW with ' +
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
