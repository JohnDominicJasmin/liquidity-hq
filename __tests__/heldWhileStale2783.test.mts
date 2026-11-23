/* QA: PR #2783 (#1651), the two plain functions behind the stale-price marks (Dev's list on the PR).
 *   STALE AGE (lib/staleAnswer.ts staleAtFromHeaders): not flagged -> null; flagged with an age -> now minus that age; flagged with NO age (null), an empty age or an unreadable age ('abc', a negative number) -> the 60 minute bound, NEVER 'now' (Number(null) is 0, which once labelled a stale price "just now")
 *   THE HOLD (lib/heldWhileStale.ts nextHeld / shownWhileStale), the logic of useHeldWhileStale that keeps a value worked out from a price (VWAP side, the distribution "Lost VWAP" input) while that price is stale:
 *     H1 live then stale: the shown value is the LAST LIVE one, even when the stale price would give the other value (above VWAP then below, and the reverse)
 *     H2 stale from the start: `none` (the input is absent)
 *     H3 a coin change while stale shows `none`, not the old coin's value
 *     H4 stale then live: the live value is shown and held again
 *     H5 nextHeld returns the SAME object when nothing changed (no render loop) and does not move while stale
 * The hook itself is a thin wrapper over these (useState + the two calls); a renderer is not available here, so the wiring is checked by reading it in the last cell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staleAtFromHeaders, STALE_BOUND_MS } from '../lib/staleAnswer.ts';
import { nextHeld, shownWhileStale, type Held } from '../lib/heldWhileStale.ts';

const NOW = 1_800_000_000_000;

test('A1 not flagged: null (a live answer carries no mark)', () => {
  assert.equal(staleAtFromHeaders(null, null, NOW), null);
  assert.equal(staleAtFromHeaders(null, '720000', NOW), null, 'an age header without the flag marks a price stale');
  assert.equal(staleAtFromHeaders('0', '720000', NOW), null); assert.equal(staleAtFromHeaders('', '720000', NOW), null);
});

test('A2 flagged with an age: now minus that age', () => {
  assert.equal(staleAtFromHeaders('1', '720000', NOW), NOW - 720_000);
  assert.equal(staleAtFromHeaders('1', '2700000', NOW), NOW - 2_700_000);
  assert.equal(staleAtFromHeaders('1', '0', NOW), NOW, 'a real age of 0 is "now"');
});

test('A3 flagged with NO age, an empty age or an unreadable age: the 60 minute bound, never now', () => {
  assert.equal(STALE_BOUND_MS, 60 * 60_000);
  for (const raw of [null, '', '   ', 'abc', '-5', 'NaN', 'Infinity']) assert.equal(staleAtFromHeaders('1', raw, NOW), NOW - STALE_BOUND_MS, `age ${JSON.stringify(raw)} was not read as the bound`);
});

/* the hook's two calls, in the order it makes them on one render: first nextHeld (its result is stored), then shownWhileStale on the NEW held */
const step = <T,>(held: Held<T> | null, coin: string, stale: boolean, live: T, none: T) => { const h = nextHeld(held, coin, stale, live); return { held: h, shown: shownWhileStale(h, coin, stale, live, none) }; };

test('H1 live then stale: the last live value stays, whichever side the stale price would give', () => {
  for (const [first, second] of [[true, false], [false, true]] as const) {      // above VWAP then the stale price is below; and the reverse
    let s = step<boolean | null>(null, 'openai', false, first, null); assert.equal(s.shown, first);
    s = step(s.held, 'openai', true, second, null); assert.equal(s.shown, first, `the stale price flipped the shown value (live ${first}, stale would be ${second})`);
    s = step(s.held, 'openai', true, !second, null); assert.equal(s.shown, first, 'a second stale render moved the value');
  }
});

test('H2 stale from the start: none', () => {
  const s = step<boolean | null>(null, 'xpt', true, true, null); assert.equal(s.shown, null); assert.equal(s.held, null, 'a stale render stored a value');
});

test('H3 a coin change while stale shows none, not the old coin\'s value', () => {
  let s = step<string | null>(null, 'copper', false, 'above', null); assert.equal(s.shown, 'above');
  s = step(s.held, 'copper', true, 'below', null); assert.equal(s.shown, 'above');
  s = step(s.held, 'xpd', true, 'below', null); assert.equal(s.shown, null, 'the old coin\'s value is shown for another coin');
  s = step(s.held, 'copper', true, 'below', null); assert.equal(s.shown, 'above', 'going back to the first coin finds its held value gone or wrong: it was not replaced while stale, so it is still held');
});

test('H4 stale then live: the live value is shown and held again', () => {
  let s = step<string | null>(null, 'ouras', false, 'a', null); s = step(s.held, 'ouras', true, 'b', null); assert.equal(s.shown, 'a');
  s = step(s.held, 'ouras', false, 'c', null); assert.equal(s.shown, 'c'); assert.deepEqual(s.held, { coin: 'ouras', v: 'c' });
  s = step(s.held, 'ouras', true, 'd', null); assert.equal(s.shown, 'c', 'the new live value is not what is held');
});

test('H5 nextHeld returns the same object when nothing changed, and does not move while stale', () => {
  const h: Held<number> = { coin: 'x', v: 1 };
  assert.equal(nextHeld(h, 'x', false, 1), h, 'same coin, same value: a new object (render loop)');
  assert.notEqual(nextHeld(h, 'x', false, 2), h); assert.deepEqual(nextHeld(h, 'x', false, 2), { coin: 'x', v: 2 });
  assert.deepEqual(nextHeld(h, 'y', false, 1), { coin: 'y', v: 1 }, 'a coin change restarts the hold');
  assert.equal(nextHeld(h, 'x', true, 99), h, 'a stale render moved the held value'); assert.equal(nextHeld(null, 'x', true, 99), null);
});

test('W1 the hook is the thin wrapper this file assumes', () => {
  const src = readFileSync(new URL('../components/StalePriceAge.tsx', import.meta.url), 'utf8');
  assert.match(src, /nextHeld\(/, 'useHeldWhileStale does not call nextHeld'); assert.match(src, /shownWhileStale\(/, 'useHeldWhileStale does not call shownWhileStale');
  assert.match(src, /useBinanceOnlyPriceStale\(coin\)/, 'the hook does not key on the Binance-only stale flag');
  const mp = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8');
  assert.match(mp, /staleAtFromHeaders\(/, 'MarketProvider does not use staleAtFromHeaders'); assert.ok(!/Number\(r\.headers\.get\('x-data-age-ms'\)\)/.test(mp), 'the Number(null) read is back in MarketProvider');
});
