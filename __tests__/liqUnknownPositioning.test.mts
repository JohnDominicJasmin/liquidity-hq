/* #1651 (the owner's data rule): an UNMEASURED long/short split must render as unknown, never as a plausible 50/50.
 *
 * WHY THIS ONE MATTERS MORE THAN IT LOOKS. The ladder used to receive `cd.longRatio ?? 0.5`, so "nobody measured the split" arrived as
 * "the split is even" and was then multiplied through every dollar figure, every bar, the magnet row, both LONG%/SHORT% readouts and a
 * "Balanced" bias verdict. **Balanced is the worst available wrong answer there**, because it is also exactly what a real even market
 * looks like - so nothing on screen invited doubt. A missing number that renders as a confident one is the whole of #1651.
 *
 * THE ORACLE is the rule, not the code: with no split, the parts that depend on it are absent, and the parts that do NOT depend on it are
 * unchanged. The second half is the one a careless fix breaks - blanking the ladder would also "hide the 50/50" while destroying the
 * screen - so the row count and the price levels are compared against a known-split run rather than against numbers typed here.
 *
 * WHAT IT CANNOT PROVE: pixels. The "-" in the amount column and the absent bias line are evaluated expressions; nothing here renders.
 * Those two readouts are still JSX in components/LiqTerminal.tsx, and the dev site is where they get looked at (#1709's Risk level). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeBands, TIERS } from '../lib/liqBands.ts';

const PRICE = 82_000, OI = 4_880_000_000, MAX = 0.25;
const unknown = () => computeBands(PRICE, OI, null, null, MAX);
const known = () => computeBands(PRICE, OI, 0.62, 0.38, MAX);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ── with no split: every figure that depends on it is absent ───────────── */

test('U1. no split: every band amount is null, so no dollar figure is invented', () => {
  const r = unknown();
  const all = [...r.longs, ...r.shortsDisplay];
  assert.ok(all.length > 0, 'precondition: the ladder produced no rows at all');
  assert.deepEqual(all.filter((b) => b.usdM !== null), [], 'a band carries an amount with no split to derive it from');
});

test('U2. no split: the bar PERCENTAGE is zero - which is a fact about the renderer INPUT, not about what is drawn (see U2b)', () => {
  /* This assertion is NOT "no bar appears". It was captioned that way once and the caption was wrong: BandRow floors every bar at
     `Math.max(b.barPct, 2)`, so 0 still painted a 2% stub on all 22 unknown rows while the amount column beside it said "-". Dev found
     that by RENDERING it, which no data-level test here could have. U2b pins the thing this test cannot see. */
  const r = unknown();
  for (const b of [...r.longs, ...r.shortsDisplay]) {
    assert.equal(b.barPct, 0, `a bar percentage of ${b.barPct} was computed from an unknown split`);
  }
});

test('U2b. THE BAR ELEMENT IS OMITTED on a row with no amount, not merely zero-width', () => {
  /* The oracle is the 2% floor's existence: while `Math.max(b.barPct, 2)` is there, "barPct is 0" and "nothing is drawn" are different
     facts, and only the second is what #1651 asks for. So this reads the renderer's own structure.
     Comments are stripped FIRST, including JSX ones. Dev's equivalent probe passed on its own replacement comment, which quoted the old
     line verbatim; the comment above this very row names both `Math.max` and `barPct`, so an unstripped match here would be vacuous. */
  const src = read('components/LiqTerminal.tsx')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')  /* JSX comments: {/* ... *\/} */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const start = src.indexOf('function BandRow');
  assert.ok(start >= 0, 'BandRow is gone or renamed - this test no longer reads what it claims to');
  const after = src.slice(start + 1);
  const end = Math.min(...['\nfunction ', '\nexport '].map((m) => after.indexOf(m)).filter((i) => i >= 0));
  const body = after.slice(0, end);

  const bars = body.match(/className="liq-row-bar"/g) ?? [];
  assert.equal(bars.length, 1, `expected exactly one bar element in BandRow, found ${bars.length} - the check below reads only one`);

  /* The gate must sit immediately before the element, with nothing but whitespace between. */
  assert.match(body, /b\.usdM !== null &&\s*<div className="liq-row-bar"/,
    'the bar element is NOT gated on b.usdM !== null: an unknown row paints a stub, because the width floor turns 0 into 2%');

  /* And the floor must be INSIDE that gate - a floor applied outside it would reintroduce the stub by another route. */
  const gated = body.slice(body.search(/b\.usdM !== null &&\s*<div className="liq-row-bar"/));
  assert.match(gated, /Math\.max\(b\.barPct, 2\)/,
    'the 2% floor is no longer inside the gated element - check where it moved before trusting this row');

  /* The amount column's dash is the other half of the same row, and it is cheap to pin here. */
  assert.match(body, /b\.usdM === null \? '-'/, 'the amount column no longer renders "-" for an unknown amount');
});

test('U3. no split: no magnet is crowned and no totals are claimed', () => {
  const r = unknown();
  assert.equal(r.magnetLong, null, 'a long magnet was marked with no amounts to compare');
  assert.equal(r.magnetShort, null, 'a short magnet was marked with no amounts to compare');
  assert.equal(r.totalLongM, null, 'a long total was claimed from an unknown split');
  assert.equal(r.totalShortM, null, 'a short total was claimed from an unknown split');
});

test('U4. ONE side unknown is still unknown on that side only, and the other side is untouched', () => {
  /* Asymmetry is the case a `?? 0.5` fix is most likely to get wrong, because the two ratios arrive from the same read. */
  const longOnly = computeBands(PRICE, OI, 0.62, null, MAX);
  assert.ok(longOnly.longs.every((b) => b.usdM !== null), 'the known long side lost its amounts');
  assert.ok(longOnly.shortsDisplay.every((b) => b.usdM === null), 'the unknown short side gained amounts');
  assert.equal(longOnly.totalShortM, null, 'a short total was claimed from an unknown short ratio');
  assert.ok(typeof longOnly.totalLongM === 'number', 'the known long total was dropped');
  assert.equal(longOnly.magnetShort, null, 'a magnet was marked on the unknown side');
  assert.ok(longOnly.magnetLong !== null, 'the known side lost its magnet');
});

/* ── and the parts that do NOT depend on the split are unchanged ────────── */

test('U5. THE LADDER IS NOT BLANKED: the rows and the price levels are identical to a known-split run', () => {
  /* The check that separates a fix from a cover-up. A price level is price x (1 ± distance) and owes nothing to the split, so it must
     survive. Compared against the known-split run rather than against a row count typed here - Dev's own probe went red twice on a
     hard-coded 34 rows where 0.25 gives 30, and a number typed into a test is a second place for the truth to live. */
  const u = unknown(), k = known();
  assert.equal(u.tierCount, k.tierCount, 'the tier count changed when the split went unknown');
  assert.deepEqual(u.longs.map((b) => b.price), k.longs.map((b) => b.price), 'the long price levels moved');
  assert.deepEqual(u.shortsDisplay.map((b) => b.price), k.shortsDisplay.map((b) => b.price), 'the short price levels moved');
  assert.deepEqual(u.longs.map((b) => b.lev), k.longs.map((b) => b.lev), 'the leverage labels changed');
  assert.deepEqual(u.longs.map((b) => b.distPct), k.longs.map((b) => b.distPct), 'the distances changed');
  assert.equal(u.tierCount, TIERS.filter((t) => t.dist <= MAX).length, 'tierCount no longer follows maxDist');
});

test('U5b. the price levels are right in absolute terms, not merely equal to each other', () => {
  /* U5 alone can be fooled: it compares the unknown run against the known run, so a change to the level formula moves BOTH and the
     comparison still passes. A mutation that scaled every distance by 0.9 survived U5 for exactly that reason, which is why this exists.
     The oracle is leverage, not the table: a 125x position liquidates on a 1/125 move, and TIERS carries that same 1/lev at every tier
     (0.0080, 0.0100, 0.0133 ... = 1/125, 1/100, 1/75), rounded to four places. So the level is checked against 1/lev read off the band's
     OWN label - a number the function does not supply - with a tolerance for the table's rounding. */
  const r = unknown();
  const tol = PRICE * 5e-5 + 1e-6; /* dist is tabulated to 4dp, so the level can sit half a unit of that away from exactly 1/lev */
  for (const b of r.longs) {
    const lev = Number(b.lev.replace('x', ''));
    assert.ok(Number.isFinite(lev) && lev > 1, `unreadable leverage label ${b.lev}`);
    assert.ok(Math.abs(b.price - PRICE * (1 - 1 / lev)) < tol, `${b.lev} long band sits at ${b.price}, not ${PRICE * (1 - 1 / lev)}`);
  }
  for (const b of r.shortsDisplay) {
    const lev = Number(b.lev.replace('x', ''));
    assert.ok(Math.abs(b.price - PRICE * (1 + 1 / lev)) < tol, `${b.lev} short band sits at ${b.price}, not ${PRICE * (1 + 1 / lev)}`);
  }
});

/* ── with a known split, nothing is suppressed ──────────────────────────── */

test('K1. a known split still produces amounts, a magnet, totals and the right proportion', () => {
  const r = known();
  assert.ok([...r.longs, ...r.shortsDisplay].every((b) => typeof b.usdM === 'number'), 'an amount went missing with a known split');
  assert.ok(r.magnetLong !== null && r.magnetShort !== null, 'the magnet rows were not marked');
  assert.equal(r.magnetLong!.isMagnet, true); assert.equal(r.magnetShort!.isMagnet, true);
  assert.ok(Math.max(...[...r.longs, ...r.shortsDisplay].map((b) => b.barPct)) > 99, 'no bar reaches full width, so nothing is the biggest');
  /* 62/38 of the same open interest: the totals must carry that ratio, not merely be non-null. */
  const ratio = r.totalLongM! / (r.totalLongM! + r.totalShortM!);
  assert.ok(Math.abs(ratio - 0.62) < 0.001, `the totals do not carry the 62/38 split: long share ${ratio}`);
});

test('K2. the magnet is the BIGGEST band, not the first one', () => {
  const r = known();
  const biggest = [...r.longs].sort((a, b) => b.usdM! - a.usdM!)[0];
  assert.equal(r.magnetLong!.price, biggest.price, 'the long magnet is not the largest band');
  assert.notEqual(r.magnetLong!.price, r.longs[0].price, 'the magnet happens to be the first row - this seed cannot tell the two apart');
});

/* ── the call site, because a pure function nobody passes null to proves nothing ── */

test('S1. the component passes the real ratios through, with NO 0.5 fallback left anywhere', () => {
  const src = read('components/LiqTerminal.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(src, /from '@\/lib\/liqBands'/, 'the component no longer imports the shared arithmetic');
  assert.equal(/function computeBands\(/.test(src), false, 'a second copy of computeBands is back in the component');
  assert.equal(/longRatio\s*\?\?\s*0\.5|shortRatio\s*\?\?\s*0\.5/.test(src), false,
    'the `?? 0.5` fallback is back: an unmeasured split would again be shown as an even one');
  /* No /s flag: this project's tsc target predates es2018 and rejects it (TS1501). None is needed - [^)] already matches newlines. */
  assert.match(src, /computeBands\([^)]*longRatio[^)]*shortRatio[^)]*\)/, 'the call site no longer passes both ratios');
});
