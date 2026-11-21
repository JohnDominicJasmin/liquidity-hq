/* QA: PR #2761 (held, v2026.11.24), #1263: a strategy or position-box label never sits on an S/R tag. The real code is cut out of components/KLineProChart.tsx and run.
 *
 * THE WRITTEN RULE (QA's #1263 measurement on prod at 390 px + Dev's PR text): a label whose CENTRE is within 14 px of an S/R tag's centre moves 14 px AWAY from the tag (up when level), at most three times, and stays inside the pane [lo, hi]. The label's text (its price) is never dropped. With no S/R layer drawn (no tag prices) every label sits exactly where it did before. The tag centre is 9 px above its line.
 *   B1  no tags, or none within 14 px: the label y is returned unchanged (the no-S/R-layer case)
 *   B2  a tag within 14 px: the label moves 14 px away; above the tag -> up, on it (equal) -> up, below -> down
 *   B3  a sweep of every offset -13.5..+13.5 px (step 0.5), one tag: the label centre ends >= 14 px from the tag, and QA's measured case (stop at 1 px from "S", target 4 px from "R", entry 8 px from "R") clears
 *   B4  the threshold is strict: exactly 14 px stays, 13.9 moves
 *   B5  at most three moves (a ladder of tags 14 px apart takes it 42 px, not further), and the result is clamped to [lo, hi] at both ends
 *   B6  srTagCenters: a tag centre is its line's y minus 9; nothing for no chart, no prices, a missing convertToPixel or a non-finite y; the pixel call names the candle pane
 *   W1  wiring: five label sites go through clearOfSrTags (the level line + the box's Target, Stop, Entry, R:R), each with the offset that matches its baseline (bottom -> -6, top -> +6), the label TEXT expressions are untouched, the off-pane edge label (arrow text) is not wrapped, and the tag prices come from the S/R layer only when it is shown
 * WHAT THIS CANNOT PROVE: the pixels on the real chart (the stub spec on a build with #2761: stop == support at 390, with and without Draw Structure). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const SRC = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function cut(re: RegExp, what: string): string {
  const m = re.exec(SRC); assert.ok(m, `not found: ${what}`);
  let i = SRC.indexOf('{', m!.index + m![0].length - 1); let d = 0; const start = m!.index;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) break; } }
  return SRC.slice(start, i + 1);
}
const CONST = /const SR_TAG_APART_PX = (\d+);/.exec(SRC); assert.ok(CONST, 'SR_TAG_APART_PX not found');
const code = stripTypeScriptTypes(`const SR_TAG_APART_PX = ${CONST![1]};\n${cut(/function srTagCenters\(/, 'srTagCenters')}\n${cut(/function clearOfSrTags\(/, 'clearOfSrTags')}`);
const mod = new Function(`${code}\nreturn { srTagCenters, clearOfSrTags, SR_TAG_APART_PX };`)() as {
  srTagCenters: (chart: unknown, prices: number[]) => number[]; clearOfSrTags: (y: number, dy: number, tags: number[], lo: number, hi: number) => number; SR_TAG_APART_PX: number;
};
const { srTagCenters, clearOfSrTags } = mod;

test('B0. the constant is 14 (the written rule)', () => assert.equal(mod.SR_TAG_APART_PX, 14));

test('B1. no tags, or none near: unchanged', () => {
  for (const [y, dy] of [[100, -6], [100, 6], [50, 0]] as const) assert.equal(clearOfSrTags(y, dy, [], 10, 296), y, 'no S/R layer');
  assert.equal(clearOfSrTags(100, -6, [200, 40, 120], 10, 296), 100, 'tags all more than 14 px from the centre (94): 40 and 120 are 54 and 26 away');
});

test('B2. a tag within 14 px: 14 px away from it (above -> up, level -> up, below -> down)', () => {
  assert.equal(clearOfSrTags(100, 0, [105], 10, 296), 86, 'label above the tag moves up');
  assert.equal(clearOfSrTags(100, 0, [100], 10, 296), 86, 'level with the tag moves up');
  assert.equal(clearOfSrTags(100, 0, [95], 10, 296), 114, 'label below the tag moves down');
});

test('B3. every offset clears, and QA\'s measured stop / target / entry cases clear', () => {
  const tc = 150; let n = 0;
  for (let off = -13.5; off <= 13.5; off += 0.5) for (const dy of [-6, 0, 6]) {
    const y = tc + off - dy; const out = clearOfSrTags(y, dy, [tc], 10, 296); n++;
    assert.ok(Math.abs(out + dy - tc) >= 14, `offset ${off} dy ${dy}: centre ${out + dy} is ${Math.abs(out + dy - tc)} px from the tag`);
  }
  /* QA #1263 on prod, 390 px, pane 302: S tag centre = line y - 9. Stop label (bottom baseline, centre = y - 6) 1 px from "S", Target 4 px from "R", Entry 8 px from "R". */
  for (const [name, label, tag] of [['Stop vs S', 273, 272], ['Target vs R', 48, 44], ['Entry vs R', 149, 141]] as const) {
    const out = clearOfSrTags(label + 6, -6, [tag], 10, 298); assert.ok(Math.abs(out - 6 - tag) >= 14, `${name}: ${Math.abs(out - 6 - tag)} px after`);
  }
  console.log(`[B3] ${n} offset cells`);
});

test('B4. the threshold is strict', () => {
  assert.equal(clearOfSrTags(100, 0, [114], 10, 296), 100, 'exactly 14 px apart stays');
  assert.equal(clearOfSrTags(100, 0, [113.9], 10, 296), 86, '13.9 px apart moves');
});

test('B5. at most three moves, clamped to the pane', () => {
  assert.equal(clearOfSrTags(100, 0, [100, 86, 72, 58], 10, 296), 58, 'a ladder of tags 14 px apart: three moves of 14 and no more (it may end on the last tag: the written limit)');
  assert.equal(clearOfSrTags(100, 0, [100, 86, 72, 58, 44, 30], 10, 296), 58, 'more tags do not buy more moves');
  assert.equal(clearOfSrTags(12, 0, [12], 10, 296), 10, 'clamped at the top (lo)');
  assert.equal(clearOfSrTags(290, 0, [296], 10, 296), 276, 'moves up inside the pane');
  assert.equal(clearOfSrTags(294, 0, [290], 10, 296), 296, 'a label below its tag at the bottom is clamped at hi');
});

test('B6. srTagCenters', () => {
  const calls: unknown[][] = []; const chart = { convertToPixel: (p: unknown, o: unknown) => { calls.push([p, o]); return { y: (p as { value: number }).value * 2 }; } };
  assert.deepEqual(srTagCenters(chart, [50, 80]), [91, 151], 'centre = the line y minus 9'); assert.deepEqual(calls[0], [{ value: 50 }, { paneId: 'candle_pane' }], 'the call names the candle pane');
  assert.deepEqual(srTagCenters(null, [50]), [], 'no chart'); assert.deepEqual(srTagCenters(chart, []), [], 'no prices');
  assert.deepEqual(srTagCenters({}, [50]), [], 'no convertToPixel'); assert.deepEqual(srTagCenters({ convertToPixel: () => ({ y: NaN }) }, [50]), [], 'a non-finite y is skipped');
  assert.deepEqual(srTagCenters({ convertToPixel: () => [{ y: 100 }] }, [50]), [91], 'the array form of the result');
});

test('W1. wiring: five sites, offsets matching their baselines, text untouched, edge label not wrapped, tag prices only when the layer is shown', () => {
  const lines = SRC.split('\n').filter((l) => l.includes('clearOfSrTags(') && !l.includes('function clearOfSrTags'));
  assert.equal(lines.length, 5, `expected 5 label sites through clearOfSrTags, found ${lines.length}`);
  for (const l of lines) {
    const dy = /clearOfSrTags\([^;]*?,\s*(-6|6|t\.y < e\.y \? 6 : -6|s\.y > e\.y \? -6 : 6),\s*(?:tagC|srTagCenters\([^)]*\)\s*(?:,|\)))/.exec(l) ?? /clearOfSrTags\(.*?,\s*(-6|6|t\.y < e\.y \? 6 : -6|s\.y > e\.y \? -6 : 6),/.exec(l); assert.ok(dy, `dy not recognised: ${l.trim().slice(0, 140)}`);
    const base = /baseline:\s*(?:'(top|bottom)'|(t\.y < e\.y \? 'top' : 'bottom')|(s\.y > e\.y \? 'bottom' : 'top'))/.exec(l); assert.ok(base, `baseline not recognised: ${l.trim().slice(0, 140)}`);
    const want = base![1] === 'bottom' ? '-6' : base![1] === 'top' ? '6' : base![2] ? 't.y < e.y ? 6 : -6' : 's.y > e.y ? -6 : 6'; assert.equal(dy![1], want, `offset ${dy![1]} does not match the baseline: ${l.trim().slice(0, 120)}`);
  }
  for (const frag of ["10, paneH - 4), text, align: 'left'", 'text: tp.text', 'text: sp.text', "text: narrow ? 'E' : d.entryText", 'text: d.rrText']) assert.ok(lines.some((l) => l.includes(frag)), `label text expression changed or missing: ${frag}`);
  const edge = SRC.split('\n').filter((l) => l.includes("${text} ${above ? '↑' : '↓'}")); assert.equal(edge.length, 1); assert.ok(!edge[0].includes('clearOfSrTags'), 'the off-pane edge label must not be moved');
  assert.match(SRC, /srTagPricesRef\.current = showSR \? srLevels\.map\(l => l\.price\) : \[\];/, 'tag prices must come from the S/R layer only when it is shown');
});
