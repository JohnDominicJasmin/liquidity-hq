import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLevels, READ_TAKER_CONFIRM_PCT, READ_LEVELS_MIN_CANDLES } from '../lib/readLevels.ts';
import { withReadLevels } from '../lib/grok.ts';
import { priceText } from '../lib/numberFormat.ts';
import { srLevels } from '../qa/fixtures/strategyFixtures.ts';

/* #2614 THE LEVELS A READ QUOTES ARE THE SERVER'S (PM: two BTC reads three minutes apart said "cancels above $64,800" and "$65,500" with taker thresholds of 55% and 60%). Expectations from the PR text:
 *   readLevels: null under 60 CLOSED candles (the forming candle is ignored: same output with one appended); the nearest resistance above and support below the LAST CLOSE from the chart's own levels (oracle: QA's copy of computeSRLevels), above > close > below;
 *   identical for any "now" inside the same candle (nothing live in it) and for Quick and Deep (one function); withReadLevels(p, null, 60) === p; the block carries the three fixed numbers and the 60% threshold, and says "none on the chart" when a side has no level.
 *   R1 min candles   R2 forming candle   R3 above > close > below and = the chart's nearest   R4 determinism within a candle   R5 junk input   R6 the prompt block   R7 the route uses it for both reads, the Deep notice is gone */
const TF = 3_600_000, T0 = Date.UTC(2026, 10, 1);
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
function series(n: number, seed = 7): C[] {
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: C[] = []; let p = 100;
  for (let i = 0; i < n; i++) { const o = p, c = o * (1 + (rnd() - 0.5) * 0.02); out.push({ time: T0 + i * TF, open: o, high: Math.max(o, c) * (1 + rnd() * 0.006), low: Math.min(o, c) * (1 - rnd() * 0.006), close: c, volume: 10 }); p = c; }
  return out;
}
const nowAfter = (cs: C[], frac = 0.5) => cs[cs.length - 1].time + TF + frac * TF;   // the last candle has closed; `frac` of the next candle has elapsed

test('R1. null under 60 closed candles, a value at 60', () => {
  assert.equal(READ_LEVELS_MIN_CANDLES, 60); const c = series(60);
  assert.ok(readLevels(c, TF, nowAfter(c)), '60 closed candles is enough'); assert.equal(readLevels(c.slice(0, 59), TF, nowAfter(c.slice(0, 59))), null, '59 is not'); assert.equal(readLevels([], TF, T0), null);
});
test('R2. the forming candle is ignored: appending one changes nothing', () => {
  const c = series(120); const now = nowAfter(c, 0.4), forming = { time: c[c.length - 1].time + TF, open: 100, high: 500, low: 1, close: 480, volume: 1 };
  assert.deepEqual(readLevels([...c, forming], TF, now), readLevels(c, TF, now), 'a forming candle moved the levels');
  const exactlyClosed = readLevels(c, TF, c[c.length - 1].time + TF); assert.ok(exactlyClosed && exactlyClosed.close === c[c.length - 1].close, 'a candle that closes exactly now is closed');
  assert.notEqual(readLevels(c, TF, c[c.length - 1].time + TF - 1)?.close, c[c.length - 1].close, 'one ms before the close it is still forming');
});
test('R3. above > close > below, and they are the nearest chart levels to the last close', () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    const c = series(200, seed), r = readLevels(c, TF, nowAfter(c)); assert.ok(r, `seed ${seed}`);
    assert.equal(r!.close, c[c.length - 1].close);
    if (r!.above != null) assert.ok(r!.above > r!.close, `seed ${seed}: above ${r!.above} <= close ${r!.close}`);
    if (r!.below != null) assert.ok(r!.below < r!.close, `seed ${seed}: below ${r!.below} >= close ${r!.close}`);
    const chart = srLevels(c, r!.close).map((l) => l.price), up = chart.filter((p) => p > r!.close), dn = chart.filter((p) => p < r!.close);
    if (r!.above != null) assert.equal(r!.above, Math.min(...up), `seed ${seed}: above is not the NEAREST resistance of the chart`);
    if (r!.below != null) assert.equal(r!.below, Math.max(...dn), `seed ${seed}: below is not the NEAREST support`);
  }
});
test('R4. nothing live in it: any "now" inside the same candle gives identical levels (two reads 40 s apart), a new closed candle may change them', () => {
  const c = series(150); const a = readLevels(c, TF, nowAfter(c, 0.01)), b = readLevels(c, TF, nowAfter(c, 0.99)); assert.deepEqual(a, b);
  const next = [...c, { ...c[c.length - 1], time: c[c.length - 1].time + TF, close: c[c.length - 1].close * 1.02 }]; assert.notEqual(readLevels(next, TF, nowAfter(next))?.close, a!.close);
});
test('R5. junk input is null, never a throw or NaN', () => {
  const c = series(100); for (const tf of [0, -1, NaN]) assert.equal(readLevels(c, tf, nowAfter(c)), null);
  const bad = c.map((x, i) => (i === c.length - 1 ? { ...x, close: NaN } : x)); assert.equal(readLevels(bad, TF, nowAfter(c)), null);
  const zero = c.map((x, i) => (i === c.length - 1 ? { ...x, close: 0 } : x)); assert.equal(readLevels(zero, TF, nowAfter(c)), null);
});
test('R6. withReadLevels: null levels leave the prompt byte-identical; the block carries the three fixed numbers and the 60% threshold; a missing side says none', () => {
  assert.equal(READ_TAKER_CONFIRM_PCT, 60); assert.equal(withReadLevels('PROMPT', null, 60), 'PROMPT');
  const b = withReadLevels('PROMPT', { close: 64000, above: 65000, below: 63000 }, 60);
  assert.ok(b.startsWith('PROMPT\n') && b.includes('FIXED WATCH LEVELS') && b.includes(priceText(64000)) && b.includes(priceText(65000)) && b.includes(priceText(63000)) && b.includes('60%'), b);
  const none = withReadLevels('PROMPT', { close: 64000, above: null, below: 63000 }, 60); assert.ok(/resistance above: none on the chart/.test(none) && none.includes(priceText(63000)));
  const none2 = withReadLevels('PROMPT', { close: 64000, above: 65000, below: null }, 60); assert.ok(/support below: none on the chart/.test(none2));
  assert.equal(withReadLevels('P', { close: 1, above: 2, below: 0.5 }, 60), withReadLevels('P', { close: 1, above: 2, below: 0.5 }, 60), 'deterministic');
});
test('R7. the grok route builds the levels once and hands them to Quick and Deep alike; the Deep-replaced notice is gone', () => {
  const route = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8'), page = readFileSync(new URL('../app/(main)/arena/page.tsx', import.meta.url), 'utf8');
  const labels = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.equal((route.match(/readLevels\(/g) ?? []).length, 1, 'readLevels is computed more than once');
  assert.ok(/withReadLevels\(withStrategyRead\(buildArenaPrompt\(/.test(route), 'the levels are not in the one prompt both reads use');
  assert.ok(!page.includes('deep-replaced-quick') && !page.includes('ARENA_DEEP_REPLACED_QUICK') && !('ARENA_DEEP_REPLACED_QUICK' in labels), 'the "levels can differ" notice must be gone');
});
