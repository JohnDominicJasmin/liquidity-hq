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
import { BYBIT_SYMS, bybitPriceFactor, bybitSymbolPriceFactor, chartDisplaySymbol } from '../lib/coins.ts';

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
