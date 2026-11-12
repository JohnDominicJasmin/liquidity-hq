/* #2200 / #1263: the REALIZED liquidation tag yields to a close support/resistance tag on the chart's right edge.
 *
 * `liftClearOfLevels` (lib/chartLabelOffsets.ts) is pure: bands + levels + the two layers' own stack offsets in,
 * the band offsets out. These cells pin its contract (Dev's four assertions on the PR), then a PIXEL MODEL asks
 * the question that matters - do any two right-axis tag boxes overlap? - for the layouts PM named.
 *
 * THE LOCAL `stackOffsets` IS A COPY of `computeLabelOffsets` in components/KLineProChart.tsx (not exported, and
 * that file imports the chart library so node cannot load it). A copy I author is a mirror, so S1 pins it by
 * SOURCE: the component must still contain the same stacking lines. If it changes, S1 fails and the copy is wrong.
 *
 * THE PIXEL MODEL: a tag sits at y(price) minus its lift; a tag box is TAG_H tall. Two boxes overlap when their
 * centres are closer than TAG_H. y(price) is linear over the chart's price range. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liftClearOfLevels, LABEL_STEP_PX } from '../lib/chartLabelOffsets.ts';
import { mergeLiqBands } from '../lib/liqClusters.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const off = (pairs: Array<[number, number]>) => new Map<number, number>(pairs);

/** COPY of computeLabelOffsets (components/KLineProChart.tsx) - see S1. */
function stackOffsets(levels: Array<{ price: number }>): Map<number, number> {
  const offsets = new Map<number, number>();
  if (levels.length < 2) return offsets;
  const sorted = [...levels].sort((a, b) => b.price - a.price);
  const spread = sorted[0].price - sorted[sorted.length - 1].price;
  const CLOSE = Math.max(spread * 0.025, 1e-9);
  let stack = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i - 1].price - sorted[i].price < CLOSE) stack += 1;
    else stack = 0;
    offsets.set(sorted[i].price, stack * 13);
  }
  return offsets;
}

test('S1. the local stackOffsets is still what the component does (source pin)', () => {
  const src = read('components/KLineProChart.tsx');
  assert.ok(src.includes('function computeLabelOffsets(levels: Array<{ price: number }>): Map<number, number>'), 'computeLabelOffsets changed its signature');
  assert.ok(src.includes('const CLOSE = Math.max(spread * 0.025, 1e-9);'), 'the 2.5%-of-spread test changed');
  assert.ok(src.includes('if (i > 0 && sorted[i - 1].price - sorted[i].price < CLOSE) stack += 1;'), 'the stacking rule changed');
  assert.ok(src.includes('offsets.set(sorted[i].price, stack * 13);'), 'the 13px step changed');
  assert.equal(LABEL_STEP_PX, 13, 'the lift step no longer matches the 13px stack step');
});

test('L1. Dev\'s contract: band 100 with levels 100.1 and 110 (spread 10, close = under 0.25)', () => {
  const bands = [{ price: 100 }]; const levels = [{ price: 100.1 }, { price: 110 }];
  assert.equal(liftClearOfLevels(off([[100, 0]]), bands, levels, off([[100.1, 0], [110, 0]])).get(100), 13, 'level offset 0 lifts the band to 13');
  assert.equal(liftClearOfLevels(off([[100, 0]]), bands, levels, off([[100.1, 13], [110, 0]])).get(100), 26, 'level offset 13 lifts the band to 26');
});

test('L2. no bands, no levels, or a band far from every level is unchanged', () => {
  const lv = off([[100.1, 0], [110, 0]]);
  assert.deepEqual([...liftClearOfLevels(off([[100, 0]]), [{ price: 100 }], [], lv)], [[100, 0]], 'no levels');
  assert.deepEqual([...liftClearOfLevels(off([]), [], [{ price: 100.1 }], lv)], [], 'no bands');
  assert.equal(liftClearOfLevels(off([[105, 0]]), [{ price: 105 }], [{ price: 100.1 }, { price: 110 }], lv).get(105), 0, 'band 105 is not close to 100.1 or 110');
});

test('L3. CONTROL: the lift only ever moves a band UP the stack (never negative, never a level)', () => {
  const out = liftClearOfLevels(off([[100, 0]]), [{ price: 100 }], [{ price: 100.1 }, { price: 110 }], off([[100.1, 0], [110, 0]]));
  assert.ok((out.get(100) ?? 0) >= 0);
  assert.equal(out.has(100.1), false, 'a level price leaked into the band offsets');
});

/* ── THE PIXEL MODEL ─────────────────────────────────────────────────────────────────────────────────────────── */
const TAG_H = 12;
type Tag = { name: string; price: number; lift: number };
function tagsFor(bands: number[], levels: number[], chartPx = 500) {
  const prices = [...bands, ...levels];
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const y = (p: number) => ((hi - p) / (hi - lo)) * chartPx;
  const b = bands.map(price => ({ price })), l = levels.map(price => ({ price }));
  const levelOffsets = stackOffsets(l);
  const bandOffsets = liftClearOfLevels(stackOffsets(b), b, l, levelOffsets);
  const tags: Array<Tag & { y: number }> = [
    ...levels.map(price => ({ name: `level ${price}`, price, lift: levelOffsets.get(price) ?? 0 })),
    ...bands.map(price => ({ name: `band ${price}`, price, lift: bandOffsets.get(price) ?? 0 })),
  ].map(t => ({ ...t, y: y(t.price) - t.lift }));
  const overlaps: string[] = [];
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    if (Math.abs(tags[i].y - tags[j].y) < TAG_H) overlaps.push(`${tags[i].name} vs ${tags[j].name} (${Math.abs(tags[i].y - tags[j].y).toFixed(1)}px apart)`);
  }
  return { tags, overlaps };
}

test('P1. one band right on an S/R level: the REALIZED tag clears the level tag', () => {
  const { overlaps } = tagsFor([100], [100, 110]);
  assert.deepEqual(overlaps, []);
});

test('P2. CONTROL: with no lift the same layout DOES overlap, so P1 can fail', () => {
  const b = [{ price: 100 }], l = [{ price: 100 }, { price: 110 }];
  const lo = 100, hi = 110, y = (p: number) => ((hi - p) / (hi - lo)) * 500;
  const bandY = y(100) - (stackOffsets(b).get(100) ?? 0), levelY = y(100) - (stackOffsets(l).get(100) ?? 0);
  assert.ok(Math.abs(bandY - levelY) < TAG_H, 'the unfixed layout does not overlap, so P1 proves nothing');
});

test('P3. the residual PM named: bands from the real merge plus a level within a few ticks - no two tag boxes overlap', () => {
  /* THE REAL MERGE, not hand-picked band prices: two clusters 10 apart fold into ONE band (BTC bucket 200, merge gap 400),
     so "two bands within a few ticks" cannot exist. The layouts that CAN exist are bands at least one merge gap apart with a
     level between or beside them, on a chart tall enough that a 13px lift does not clear the level. */
  const merged = mergeLiqBands([{ price: 74010, total: 1 }, { price: 74000, total: 1 }, { price: 74500, total: 1 }]).map(x => x.price);
  assert.equal(merged.length, 2, `the merge should fold 74000 and 74010 into one band: ${merged}`);
  for (const levelPrice of [74250, 74255, 74245]) {
    const { overlaps, tags } = tagsFor(merged, [levelPrice, 83000]);
    assert.deepEqual(overlaps, [], `level ${levelPrice} with bands ${merged}: tags overlap: ${overlaps.join('; ')} | lifts: ${tags.map(t => `${t.name}=${t.lift}`).join(', ')}`);
  }
});

test('P3b. a merged band with two levels a few ticks either side of it - no two tag boxes overlap', () => {
  /* The two clusters merge into one band (~74005); levels 74003 and 74008 sit within a few ticks of it and of each other,
     with a far level so the spread is real. All three tags would sit on one spot without the stack and the lift. */
  const merged = mergeLiqBands([{ price: 74010, total: 1 }, { price: 74000, total: 1 }]).map(x => x.price);
  assert.equal(merged.length, 1);
  const { overlaps, tags } = tagsFor(merged, [74003, 74008, 83000]);
  assert.deepEqual(overlaps, [], `tags overlap: ${overlaps.join('; ')} | lifts: ${tags.map(t => `${t.name}=${t.lift}`).join(', ')}`);
});

test('P4. the S/R tags never move because of the lift', () => {
  const levels = [100.1, 110], l = levels.map(price => ({ price }));
  const before = stackOffsets(l);
  tagsFor([100], levels);
  assert.deepEqual([...stackOffsets(l)], [...before]);
});
