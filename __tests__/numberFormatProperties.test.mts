/* #1651 layer 4: property tests for the app's number text (lib/numberFormat.ts). The example tests (aiPromptPerCoin, #1665) pin a few
 * literals; these hold the RULES over thousands of values, so a change that keeps the examples and breaks some other size is caught.
 *
 * THE ORACLE is the rule each function states, checked by reading the text back as a number (never by comparing with the function's own
 * output): a price keeps four significant digits at any size, never an exponent, and never loses its minus; a signed amount always carries
 * its real sign. The values come from a seeded generator, so a failure names a value that reproduces.
 *
 * F6 is the codebase half of the sign rule (#1651 layer 1 asks for a lint rule that forbids hand-rolled signs): no file outside
 * lib/numberFormat.ts builds `v >= 0 ? '+' : ''` next to `Math.abs`, the shape that printed an ETH ETF outflow of -$26.1M as "$26M".
 * Measured before writing it: zero live sites. The detector is run on a known bad line first, so "no matches" is not a broken pattern.
 *
 * F7 IS A TODO, written ahead of #1651 layer 1 (`Reading` with an unknown status): today priceText(NaN) prints "$NaN", Infinity "$∞",
 * and signedUsd(NaN) "-$NaNM". It reports without failing the run until that layer lands; then the todo comes off.
 *
 * WHAT IT CANNOT PROVE: that a screen calls these functions rather than its own formatting (F6 sees one line at a time), or locale
 * grouping other than en-US. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { priceDigits, priceText, signedUsd, signOf } from '../lib/numberFormat.ts';

/** mulberry32: a small seeded generator, so every run tests the same values. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Log-uniform positives from 1e-9 to 1e7: PEPE-sized to BTC-sized and past it, every decade equally often. */
function prices(n: number, seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => 10 ** (-9 + r() * 16));
}
const back = (s: string) => Number(s.replace(/,/g, ''));

test('F1. a price reads back within four significant digits at every size, and is never written as an exponent', () => {
  for (const v of prices(3000, 1651)) {
    const s = priceDigits(v);
    assert.doesNotMatch(s, /e/i, `${v} was written as an exponent: ${s}`);
    assert.match(s, /^-?[\d,]+(\.\d+)?$/, `${v} is not plain digits: ${s}`);
    const rel = Math.abs(back(s) - v) / v;
    assert.ok(rel <= 5.0001e-4, `${v} printed ${s}: off by ${(rel * 100).toFixed(4)}%, more than four significant digits allow`);
  }
});

test('F2. a price at or above 1 keeps its decimals (XRP $2.3456 is not "$2" or "$1"); at or above 1000 it is grouped', () => {
  for (const v of prices(3000, 7).filter((x) => x >= 1)) {
    const s = priceDigits(v);
    const allowed = v >= 1000 ? 0.005 : 0.00005;
    assert.ok(Math.abs(back(s) - v) <= allowed + 1e-12, `${v} printed ${s}`);
    if (v >= 1000) assert.match(s, /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/, `${v} is not grouped in thousands: ${s}`);
  }
});

test('F3. the minus of a negative is never dropped: priceDigits(-v) is "-" and the digits of v', () => {
  for (const v of prices(2000, 42)) assert.equal(priceDigits(-v), '-' + priceDigits(v), `${-v}`);
  assert.equal(priceText(-2.3456), '$-2.3456');
});

test('F4. a signed amount always carries its real sign, and its magnitude is the value\'s, in the unit asked for', () => {
  const r = rng(99);
  for (let i = 0; i < 3000; i++) {
    const v = (r() - 0.5) * 10 ** (r() * 6);
    const digits = Math.floor(r() * 3);
    const unit = (['', 'K', 'M', 'B'] as const)[Math.floor(r() * 4)];
    const s = signedUsd(v, unit, digits);
    assert.equal(s[0], v < 0 ? '-' : '+', `${v} printed ${s}`);
    assert.equal(s[0], signOf(v), `signOf(${v}) disagrees with signedUsd`);
    assert.equal(s, `${s[0]}$${Math.abs(v).toFixed(digits)}${unit}`, `${v} printed ${s}`);
  }
  assert.equal(signedUsd(-0.04, 'M', 1), '-$0.0M', 'a small outflow keeps its minus even when it rounds to zero');
});

/* A sign built as "+" or nothing, in front of Math.abs, on one line: the minus of every negative is lost. */
const DROPS_MINUS = /['"`]\+['"`]\s*:\s*['"`]{2}.*Math\.abs|Math\.abs.*['"`]\+['"`]\s*:\s*['"`]{2}/;

test('F6. no file outside lib/numberFormat.ts builds a sign as "+" or nothing next to Math.abs', () => {
  for (const bad of ["x = (v >= 0 ? '+' : '') + '$' + Math.abs(v)", 'x = `${v >= 0 ? "+" : ""}$${Math.abs(v)}`']) {
    assert.match(bad, DROPS_MINUS, `the detector misses a known bad line: ${bad}`);
  }
  assert.doesNotMatch("x = signOf(v) + '$' + Math.abs(v)", DROPS_MINUS);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name) || rel === 'lib/numberFormat.ts') continue;
      const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      src.split(/\r?\n/).forEach((line, i) => { if (!/^\s*\/\//.test(line) && DROPS_MINUS.test(line)) hits.push(`${rel}:${i + 1}`); });
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.deepEqual(hits, [], 'use signOf / signedUsd from lib/numberFormat.ts instead');
});

test('F7. an unknown number (NaN, Infinity) is never printed as one', { todo: '#1651 layer 1: the Reading/unknown state is not built yet; today "$NaN", "$∞", "-$NaNM"' }, () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    for (const s of [priceText(v), priceDigits(v), signedUsd(v, 'M', 1)]) {
      assert.doesNotMatch(s, /NaN|∞|Infinity/, `${v} printed ${s}`);
      assert.doesNotMatch(s, /^[-+]?\$?[\d,.]+[KMB]?$/, `${v} printed ${s}, which reads as a real number`);
    }
  }
});
