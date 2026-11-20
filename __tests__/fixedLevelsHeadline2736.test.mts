/* QA: PR #2736 (PM 2026-11-20), a FULL Bullish / Bearish read printed only "Bearish." under the verdict when the model's own LEVELS held no usable support and resistance (none written, or lib/grok.ts levelContradictsClose dropped them). Deterministic fix, no prompt change.
 *
 * THE WRITTEN RULE (the PR body; expectations are literals from it, never derived from the code under test):
 *   the route returns result.fixedLevels = { above, below } (lib/readLevels.ts, the numbers the prompt already quotes), null when readLevels gave none
 *   CombinedResult.fixedLevels is carried by normalizeCombinedResult: finite positive numbers only, anything else on that side is null; a read from before the field has none
 *   plainSummary(signal, levels, fixed?): a side the read's own LEVELS leave empty takes the fixed level (support below / resistance above); the model's levels STILL WIN when present
 *   plainSummary('BEARISH', [], {above: 62615, below: 61958.7}) has watch (below $61,958.7) and cancel (above $62,615); with no fixed levels and no model levels it is the bare verdict
 *   the Arena page passes result.fixedLevels; with only a cancel level the headline is "<verdict without its period>; <cancel text>." ("Bearish; a move back above $62,615 cancels it.") instead of the bare verdict
 *   FLAT and an unknown tier are unchanged: fixed levels never give a FLAT read a clause
 *   F1 plainSummary takes the fixed level for an empty side (Bearish / Bullish / lean, both directions)   F2 the model's levels win, side by side and both sides   F3 no fixed + no model = the bare verdict; one fixed side = one clause; non-finite fixed dropped
 *   F4 FLAT / unknown tier unchanged   F5 normalizeCombinedResult keeps finite positive sides and drops the rest   F6 the route statement, run on literal readLevels results, plus the chain readLevels -> route -> plainSummary
 *   F7 the Arena headline logic run on the real plainSummary and the real English labels: watch + cancel, cancel only, watch only, bare, FLAT   F8 the page passes result.fixedLevels and keeps the period-strip
 * WHAT THIS CANNOT PROVE: the headline drawn in the browser on a real full Bearish read (BTC 1h, 390 / 768 / 1280, light and dark) and what a live model returns; the route statement is run, but the route itself (a paid AI call) is not.
 * WHAT IT DOES NOT PIN: the exact shape normalizeCombinedResult gives when the field is present with BOTH sides unusable ({} / zeros): the PR does not say whether that is dropped or a null pair, so the test accepts either (no usable level on either side). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { plainSummary } from '../lib/plainSummary.ts';
import type { SummaryLevel } from '../lib/plainSummary.ts';
import { normalizeCombinedResult } from '../lib/grok.ts';
import { readLevels } from '../lib/readLevels.ts';
import { priceText } from '../lib/numberFormat.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const L = (price: number, type: 'support' | 'resistance'): SummaryLevel => ({ price, type });
const FIXED = { above: 62615, below: 61958.7 };   // the PR body's numbers

test('F1. a side the read left empty takes the fixed level: Bearish and Bullish, full and lean', () => {
  const bear = plainSummary('BEARISH', [], FIXED);
  assert.deepEqual(bear, { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_BELOW', price: '$61,958.7' }, cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_ABOVE', price: '$62,615' } });
  const bull = plainSummary('BULLISH', [], FIXED);
  assert.deepEqual(bull, { verdictKey: 'ARENA_PLAIN_SUMMARY_BULLISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_ABOVE', price: '$62,615' }, cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_BELOW', price: '$61,958.7' } });
  /* the same two levels, the roles swap between the directions */
  assert.equal(bull?.watch?.price, bear?.cancel?.price); assert.equal(bull?.cancel?.price, bear?.watch?.price);
  assert.deepEqual(plainSummary('LEAN BEARISH', [], FIXED), { verdictKey: 'ARENA_PLAIN_SUMMARY_LEAN_BEARISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_BELOW', price: '$61,958.7' }, cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_ABOVE', price: '$62,615' } });
  assert.deepEqual(plainSummary('LEAN BULLISH', [], FIXED), { verdictKey: 'ARENA_PLAIN_SUMMARY_LEAN_BULLISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_ABOVE', price: '$62,615' }, cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_BELOW', price: '$61,958.7' } });
  /* CONTROL: without the third argument the same read is the bare verdict, so the clauses above come from `fixed` and from nothing else */
  assert.deepEqual(plainSummary('BEARISH', []), { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH' });
});

test('F2. the model\'s own levels still win: one side, the other side, both sides', () => {
  /* Model support $61,000 is LOWER than the fixed support $61,958.7: a function that merged both lists and took the nearest would print the fixed one. */
  const supOnly = plainSummary('BEARISH', [L(61000, 'support')], FIXED);
  assert.equal(supOnly?.watch?.price, '$61,000', 'the model\'s support must win over the fixed one'); assert.equal(supOnly?.cancel?.price, '$62,615', 'the empty resistance side takes the fixed level');
  /* Model resistance $63,000 is HIGHER than the fixed resistance $62,615: a merge taking the nearest would print the fixed one. */
  const resOnly = plainSummary('BEARISH', [L(63000, 'resistance')], FIXED);
  assert.equal(resOnly?.cancel?.price, '$63,000', 'the model\'s resistance must win over the fixed one'); assert.equal(resOnly?.watch?.price, '$61,958.7', 'the empty support side takes the fixed level');
  /* the mirror for a Bullish read */
  const bullSup = plainSummary('BULLISH', [L(61000, 'support')], FIXED);
  assert.equal(bullSup?.cancel?.price, '$61,000'); assert.equal(bullSup?.watch?.price, '$62,615');
  /* both sides present: the fixed levels are not used at all, for every directional tier, and the result equals the call without them */
  const both = [L(60000, 'support'), L(64000, 'resistance')];
  for (const tier of ['BEARISH', 'BULLISH', 'LEAN BEARISH', 'LEAN BULLISH']) {
    assert.deepEqual(plainSummary(tier, both, FIXED), plainSummary(tier, both), `${tier}: the fixed levels changed a read that already had both sides`);
  }
  assert.equal(plainSummary('BEARISH', both, FIXED)?.watch?.price, '$60,000'); assert.equal(plainSummary('BEARISH', both, FIXED)?.cancel?.price, '$64,000');
  /* a NaN-only model side counts as EMPTY (it is dropped before the check), so the fixed level fills it */
  assert.equal(plainSummary('BEARISH', [L(NaN, 'support')], FIXED)?.watch?.price, '$61,958.7');
});

test('F3. no usable fixed level and no model level: the bare verdict; one fixed side gives one clause; non-finite fixed is dropped', () => {
  const bare = { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH' };
  for (const fixed of [undefined, null, { above: null, below: null }, { above: NaN, below: Infinity }, { above: -Infinity, below: NaN }]) {
    assert.deepEqual(plainSummary('BEARISH', [], fixed), bare, `fixed ${JSON.stringify(fixed)} must leave the bare verdict`);
  }
  assert.deepEqual(plainSummary('BEARISH', [], { above: 62615, below: null }), { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH', cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_ABOVE', price: '$62,615' } }, 'resistance only: a cancel clause, no invented watch');
  assert.deepEqual(plainSummary('BEARISH', [], { above: null, below: 61958.7 }), { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_BELOW', price: '$61,958.7' } }, 'support only: a watch clause, no invented cancel');
  assert.deepEqual(plainSummary('BEARISH', [], { above: NaN, below: 61958.7 }), { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH', watch: { key: 'ARENA_PLAIN_SUMMARY_WATCH_BELOW', price: '$61,958.7' } }, 'a NaN side is dropped and the other side still renders');
  assert.deepEqual(plainSummary('BULLISH', [], { above: null, below: 61958.7 }), { verdictKey: 'ARENA_PLAIN_SUMMARY_BULLISH', cancel: { key: 'ARENA_PLAIN_SUMMARY_CANCEL_BELOW', price: '$61,958.7' } }, 'Bullish with only a support: the cancel clause alone');
});

test('F4. FLAT and an unknown tier are unchanged by fixed levels', () => {
  assert.deepEqual(plainSummary('FLAT', [], FIXED), { verdictKey: 'ARENA_PLAIN_SUMMARY_FLAT' }, 'FLAT has no direction: no clause even when fixed levels exist');
  assert.deepEqual(plainSummary('FLAT', [L(100, 'support'), L(200, 'resistance')], FIXED), { verdictKey: 'ARENA_PLAIN_SUMMARY_FLAT' });
  for (const unknown of ['NEUTRAL', 'WOBBLY', '', 'bearish', 'BEARISH ']) assert.equal(plainSummary(unknown, [], FIXED), null, `'${unknown}' must not produce a line`);
});

test('F5. normalizeCombinedResult carries finite positive fixed levels and drops the rest', () => {
  const base = { signal: 'BEARISH', confidence: 70, levels: [], chartAnalysis: 'x', patterns: [], reasoning: 'r', catalysts: [] };
  const norm = (fixedLevels?: unknown, withKey = true) => normalizeCombinedResult(withKey ? { ...base, fixedLevels } : base, '1h', 'US')!;
  assert.ok(norm({ above: 1, below: 1 }), 'CONTROL: the fixture is a valid read');
  assert.deepEqual(norm({ above: 62615, below: 61958.7 }).fixedLevels, { above: 62615, below: 61958.7 }, 'both finite positive sides are kept as they are');
  assert.deepEqual(norm({ above: 62615, below: null }).fixedLevels, { above: 62615, below: null }); assert.deepEqual(norm({ above: null, below: 61958.7 }).fixedLevels, { above: null, below: 61958.7 });
  assert.deepEqual(norm({ above: 62615 }).fixedLevels, { above: 62615, below: null }, 'a missing side is null, the present one is kept');
  /* every kind of garbage on ONE side is dropped to null while the good side survives */
  for (const bad of [0, -5, NaN, Infinity, -Infinity, '62615', '', true, [], {}, undefined, null]) {
    const r = norm({ above: bad, below: 61958.7 }).fixedLevels; assert.deepEqual(r, { above: null, below: 61958.7 }, `above=${String(bad)} must be dropped`);
    const s = norm({ above: 62615, below: bad }).fixedLevels; assert.deepEqual(s, { above: 62615, below: null }, `below=${String(bad)} must be dropped`);
  }
  /* no usable level on either side, in every shape: the consumer sees nothing (absent, null, or a null pair) */
  const none = (v: { above: number | null; below: number | null } | null | undefined) => (v?.above ?? null) === null && (v?.below ?? null) === null;
  for (const v of [{}, { above: 0, below: -1 }, { above: NaN, below: 'x' }, { above: '1', below: '2' }, null, undefined, 'x', 7, true]) assert.ok(none(norm(v).fixedLevels), `${JSON.stringify(v)} must leave no usable level`);
  assert.ok(none(norm(undefined, false).fixedLevels), 'a read from before the field has none');
  /* the carried levels reach the headline: Bearish with no model levels names both */
  const r = norm({ above: 62615, below: 61958.7 }); assert.equal(plainSummary(r.signal, r.levels, r.fixedLevels)?.watch?.price, '$61,958.7');
  /* a normalized read with garbage fixed levels is the bare verdict, so a dropped number is never printed */
  const g = norm({ above: 0, below: -3 }); assert.deepEqual(plainSummary(g.signal, g.levels, g.fixedLevels), { verdictKey: 'ARENA_PLAIN_SUMMARY_BEARISH' });
});

test('F6. the route returns fixedLevels from readLevels: statement run on literals, premise pins, and the chain to the headline', () => {
  const route = read('app/api/grok/route.ts');
  const m = /result\.fixedLevels = ([^;]+);/.exec(route); assert.ok(m, 'CONTROL: the route no longer assigns result.fixedLevels');
  assert.equal(route.match(/result\.fixedLevels\s*=/g)!.length, 1, 'one assignment');
  const run = new Function('levels', `return (${stripTypeScriptTypes(`const _e = ${m![1]};`).replace(/^const _e = /, '').replace(/;\s*$/, '')});`) as (l: unknown) => unknown;
  assert.deepEqual(run({ close: 62000, above: 62615, below: 61958.7 }), { above: 62615, below: 61958.7 }, 'the response carries the two levels and not the close');
  assert.deepEqual(run({ close: 62000, above: null, below: 61958.7 }), { above: null, below: 61958.7 }, 'a missing side travels as null');
  assert.deepEqual(run({ close: 62000, above: 62615, below: null }), { above: 62615, below: null });
  assert.equal(run(null), null, 'readLevels gave none: null, not an invented pair');
  /* the premise: `levels` IS the readLevels result and the SAME object the prompt quotes */
  assert.match(route, /let levels: ReturnType<typeof readLevels> = null;/); assert.match(route, /levels = readLevels\(await fetchRibbonCandles\(/);
  assert.match(route, /withReadLevels\([^;]*, levels, READ_TAKER_CONFIRM_PCT\)/, 'the prompt must quote the same `levels` the response carries');
  /* position: the assignment is on the answer that is returned, after the last mutation of result and before the one success response */
  const at = route.indexOf(m![0]), ret = route.indexOf('return NextResponse.json({ result, usage });'), restated = route.lastIndexOf('if (restated)');
  assert.ok(restated > 0 && restated < at && at < ret, 'result.fixedLevels must be set after the checks and before the success response'); assert.equal(route.match(/NextResponse\.json\(\{ result/g)!.length, 1, 'a second success response would skip it');
  /* the chain on a literal series: readLevels -> the route's statement -> normalize -> plainSummary names the levels the prompt quotes */
  const TF = 3_600_000, T0 = Date.UTC(2026, 10, 1); let s = 7 >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const c: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = []; let p = 100;
  for (let i = 0; i < 200; i++) { const o = p, cl = o * (1 + (rnd() - 0.5) * 0.02); c.push({ time: T0 + i * TF, open: o, high: Math.max(o, cl) * (1 + rnd() * 0.006), low: Math.min(o, cl) * (1 - rnd() * 0.006), close: cl, volume: 10 }); p = cl; }
  const rl = readLevels(c, TF, c[c.length - 1].time + TF * 1.5); assert.ok(rl && rl.above != null && rl.below != null && rl.above > rl.close && rl.close > rl.below, 'CONTROL: the literal series has a level on each side');
  const body = run(rl) as { above: number; below: number }; assert.equal(body.above, rl!.above); assert.equal(body.below, rl!.below);
  const n = normalizeCombinedResult({ signal: 'BEARISH', confidence: 60, levels: [], fixedLevels: body }, '1h', 'US')!;
  const ps = plainSummary(n.signal, n.levels, n.fixedLevels); assert.ok(ps?.watch && ps?.cancel, 'a full Bearish read with no model levels must name both levels');
  assert.equal(ps!.watch!.price, priceText(rl!.below!), 'the watch level is the support the prompt quotes'); assert.equal(ps!.cancel!.price, priceText(rl!.above!), 'the cancel level is the resistance the prompt quotes');
});

/* The Arena headline: the logic of the IIFE in the page is CUT FROM THE SOURCE and run with the real plainSummary and the real English labels, so the text the reader sees is asserted whole. */
function arenaHeadline(): (result: { signal: string; levels: SummaryLevel[]; fixedLevels?: { above: number | null; below: number | null } | null }, t: (k: string, v?: { price: string }) => string) => string | null {
  const page = read('app/(main)/arena/page.tsx');
  const A = 'const ps = plainSummary(', Z = 'return <p className="av-summary" data-testid="arena-plain-summary">{';
  const a = page.indexOf(A), z = page.indexOf(Z, a), end = page.indexOf('}</p>;', z);
  assert.ok(a > 0 && z > a && end > z, 'CONTROL: the plain summary block was not found in the page');
  const logic = page.slice(a, z), expr = page.slice(z + Z.length, end);
  const js = stripTypeScriptTypes(`function _h(result, t, plainSummary) {\n${logic}\nreturn (${expr});\n}`);
  const fn = new Function('plainSummary', `${js}\nreturn _h;`)(plainSummary) as (r: unknown, t: unknown, p: unknown) => string | null;
  return (result, t) => fn(result, t, plainSummary);
}
const EN: Record<string, string> = JSON.parse(read('lib/labelDefaults.en.json'));
const tEn = (k: string, v?: { price: string }) => (EN[k] ?? `<<${k}>>`).replace('{price}', v?.price ?? '');

test('F7. the Arena headline: watch + cancel, cancel only, watch only, bare, FLAT (the real labels, whole sentences)', () => {
  const head = arenaHeadline();
  /* sanity of the literals the expectations below lean on: the labels the page reads */
  assert.equal(EN.ARENA_PLAIN_SUMMARY_BEARISH, 'Bearish.'); assert.equal(EN.ARENA_PLAIN_SUMMARY_BULLISH, 'Bullish.');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: FIXED }, tEn), 'Watch $61,958.7: a break below confirms it; a move back above $62,615 cancels it.', 'the full Bearish read with no model levels names both levels (the PR body\'s numbers)');
  assert.equal(head({ signal: 'BULLISH', levels: [], fixedLevels: FIXED }, tEn), 'Watch $62,615: a break above confirms it; a move back below $61,958.7 cancels it.');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: { above: 62615, below: null } }, tEn), 'Bearish; a move back above $62,615 cancels it.', 'only a cancel level: the verdict without its period, then the cancel text');
  assert.equal(head({ signal: 'BULLISH', levels: [], fixedLevels: { above: null, below: 61958.7 } }, tEn), 'Bullish; a move back below $61,958.7 cancels it.');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: { above: null, below: 61958.7 } }, tEn), 'Watch $61,958.7: a break below confirms it.', 'only a watch level: the watch clause and a full stop');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: null }, tEn), 'Bearish.', 'no fixed and no model level: the bare verdict, with its own period');
  assert.equal(head({ signal: 'BEARISH', levels: [] }, tEn), 'Bearish.', 'a read from before the field behaves as before');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: { above: NaN, below: NaN } }, tEn), 'Bearish.');
  assert.equal(head({ signal: 'LEAN BEARISH', levels: [], fixedLevels: null }, tEn), 'Leaning bearish.');
  assert.equal(head({ signal: 'LEAN BEARISH', levels: [], fixedLevels: { above: 62615, below: null } }, tEn), 'Leaning bearish; a move back above $62,615 cancels it.');
  /* the model's own levels win in the page too, and fixed ones are ignored when both sides exist */
  assert.equal(head({ signal: 'BEARISH', levels: [L(61000, 'support'), L(63000, 'resistance')], fixedLevels: FIXED }, tEn), 'Watch $61,000: a break below confirms it; a move back above $63,000 cancels it.');
  assert.equal(head({ signal: 'LEAN BEARISH', levels: [L(61000, 'support'), L(63000, 'resistance')], fixedLevels: null }, tEn), 'Watch $61,000: a break below confirms it; a move back above $63,000 cancels it.', 'a lean read with its own levels is unchanged');
  assert.equal(head({ signal: 'FLAT', levels: [], fixedLevels: FIXED }, tEn), 'No clear direction yet.', 'FLAT is the verdict only');
  assert.equal(head({ signal: 'WOBBLY', levels: [], fixedLevels: FIXED }, tEn), null, 'an unknown tier renders nothing');
});

test('F8. the page passes result.fixedLevels and strips the verdict period in every language', () => {
  const page = read('app/(main)/arena/page.tsx'); const head = arenaHeadline();
  assert.match(page, /plainSummary\(result\.signal, result\.levels, result\.fixedLevels\)/, 'the page must hand the read\'s fixedLevels to plainSummary');
  assert.equal(page.match(/plainSummary\(/g)!.length, 1, 'one call site: a second would need the same argument');
  /* the period strip covers the full-width stop of the CJK labels too: a bare verdict "看跌。" must not print "看跌。; ..." */
  const tZh = (k: string, v?: { price: string }) => ({ ARENA_PLAIN_SUMMARY_BEARISH: '看跌。', ARENA_PLAIN_SUMMARY_CANCEL_ABOVE: `回升至 ${v?.price} 以上则取消` } as Record<string, string>)[k] ?? `<<${k}>>`;
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: { above: 62615, below: null } }, tZh), '看跌; 回升至 $62,615 以上则取消.', 'the ideographic full stop is stripped before the semicolon');
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: null }, tZh), '看跌。', 'the bare verdict keeps its own stop');
  /* only a TRAILING stop is removed: a stop inside the verdict stays */
  const tMid = (k: string, v?: { price: string }) => ({ ARENA_PLAIN_SUMMARY_BEARISH: 'Bearish. Mostly.', ARENA_PLAIN_SUMMARY_CANCEL_ABOVE: `above ${v?.price}` } as Record<string, string>)[k] ?? `<<${k}>>`;
  assert.equal(head({ signal: 'BEARISH', levels: [], fixedLevels: { above: 62615, below: null } }, tMid), 'Bearish. Mostly; above $62,615.');
});
