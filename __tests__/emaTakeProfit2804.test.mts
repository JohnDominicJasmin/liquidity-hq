/* QA: PR #2804 (#1263 owner item 8), the EMA card's take-profit is two times the risk measured from the ENTRY the card shows (the 20 EMA), not from the last price.
 * The stop / target block is SLICED from the real hook and run (the hook itself needs React). The slice is our own checked-in source, never input.
 *   T1 long setup: target 2:1 from the 20 EMA entry, stop 0.5% under the 50 EMA, and the last price does not move either
 *   T2 short setup: the mirror
 *   T3 any other verdict: no stop and no target
 *   T4 the card's "Entry" line is the same 20 EMA (so the three numbers on screen are the ones this measures) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HOOK = read('lib/useEMAStrategy.ts');
const from = HOOK.indexOf('const BUF = 0.005;'), to = HOOK.indexOf('// Conditions checklist', from);
const block = HOOK.slice(from, to).replace(/: number \| null/g, '');
const levels = new Function('verdict', 'price', 'ema20', 'ema50', `${block}\nreturn { sl, tp };`) as (v: string, price: number, ema20: number, ema50: number) => { sl: number | null; tp: number | null };
const round = (n: number) => Math.round(n * 1e9) / 1e9;

test('T0. CONTROL: the block was found and is the one that sets both levels', () => {
  assert.ok(from > 0 && to > from, 'the stop / target block moved'); assert.match(block, /sl = /); assert.match(block, /tp = /);
});

test('T1. long: stop 0.5% under the 50 EMA, target twice that risk above the 20 EMA, whatever the last price is', () => {
  for (const price of [100, 101, 102, 140]) {
    const { sl, tp } = levels('LONG_SETUP', price, 100, 96);
    assert.equal(round(sl!), round(96 * 0.995)); assert.equal(round((tp! - 100) / (100 - sl!)), 2, `price ${price}: reward to risk from the entry`); assert.equal(round(tp!), round(100 + 2 * (100 - 96 * 0.995)));
  }
});

test('T2. short: stop 0.5% over the 50 EMA, target twice that risk below the 20 EMA, whatever the last price is', () => {
  for (const price of [100, 99, 98, 60]) {
    const { sl, tp } = levels('SHORT_SETUP', price, 100, 104);
    assert.equal(round(sl!), round(104 * 1.005)); assert.equal(round((100 - tp!) / (sl! - 100)), 2, `price ${price}: reward to risk from the entry`); assert.equal(round(tp!), round(100 - 2 * (104 * 1.005 - 100)));
  }
});

test('T3. no setup, no stop and no target', () => {
  for (const v of ['TRENDING_LONG', 'TRENDING_SHORT', 'FREEZE', 'WAIT']) assert.deepEqual(levels(v, 101, 100, 96), { sl: null, tp: null }, v);
});

test('T4. the entry the card shows is the 20 EMA the target is measured from', () => {
  assert.match(read('components/EMASignal.tsx'), /t\('EMA_SIGNAL_ENTRY_LINE', \{ price: `\$\{currencyPrefix\(coin\)\}\$\{fmt\(signal\.ema20_4h\)\}` \}\)/);
  assert.match(HOOK, /ema20_4h:\s*ema20\b/);
});
