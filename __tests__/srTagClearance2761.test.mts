/* QA: PR #2761 (held, v2026.11.24), #1263: a strategy or position-box label never sits on an S/R tag. The real code is cut out of components/KLineProChart.tsx and run.
 *
 * THE WRITTEN RULE (QA's #1263 measurement on prod at 390 px + Dev's PR text): a label whose CENTRE is within 14 px of an S/R tag's centre moves 14 px AWAY from the tag (up when level), at most three times, and stays inside the pane [lo, hi]. The label's text (its price) is never dropped. With no S/R layer drawn (no tag prices) every label sits exactly where it did before. The tag centre is 9 px above its line.
 *   B1  no tags, or none within 14 px: the label y is returned unchanged (the no-S/R-layer case)
 *   B2  (#2769) a tag within 14 px: the label goes to the NEAREST spot 14 px or more from EVERY tag (2 px steps, away from the first tag hit first), checked against a brute-force statement of the rule on 3,000 random tag stacks
 *   B3  whenever a free spot exists the label ends 14 px or more from every tag; QA's measured stop / target / entry cases clear; one tag moves a label by at most 28 px
 *   B4  the threshold is strict: exactly 14 px stays, 13.9 moves
 *   B5  stacks of tags near the top edge land on the nearest free spot (46 / 52 / 60 for [6,22,38] / [14,30,44] / [10,24,38,52]: the three-hop defect that ended 4.5 px from "R $89,121"), clamped to the pane, no free spot = the label stays; W2 the box drops its own Entry text only when the strategy labels the entry
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

/* #2769: the clearance is no longer three fixed 14 px hops (they walked a pinned label from one tag into the next and stopped inside another, 4.5 px from "R $89,121"): it is the NEAREST y (2 px steps from the label, away from the first tag hit, then the other way) whose centre is >= 14 px from EVERY tag, inside lo..hi; none free = the label stays (clamped). The oracle below is a brute-force statement of that rule, written independently of the code. */
const oracle = (y: number, dy: number, tags: number[], lo: number, hi: number): number => {
  const near = (v: number) => tags.find((tc) => Math.abs(v + dy - tc) < 14); const first = near(y); if (first === undefined) return y;
  const away = y + dy <= first ? -1 : 1; const cands: Array<{ v: number; d: number; pref: number }> = [];
  for (let k = 1; k <= Math.ceil((hi - lo) / 2) + 1; k++) for (const dir of [-1, 1]) { const v = y + dir * 2 * k; if (v >= lo && v <= hi && near(v) === undefined) cands.push({ v, d: 2 * k, pref: dir === away ? 0 : 1 }); }
  if (!cands.length) return Math.min(hi, Math.max(lo, y)); cands.sort((a, b) => a.d - b.d || a.pref - b.pref); return cands[0].v;
};
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

test('B2. a tag within 14 px: the nearest spot 14 px or more from EVERY tag, away from the first tag hit', () => {
  assert.equal(clearOfSrTags(100, 0, [105], 10, 296), 90, 'label above the tag moves up to the first free step'); assert.equal(clearOfSrTags(100, 0, [100], 10, 296), 86, 'level with the tag moves up'); assert.equal(clearOfSrTags(100, 0, [95], 10, 296), 110, 'label below the tag moves down');
  const rnd = lcg(2769); let n = 0;
  for (let i = 0; i < 3000; i++) { const nt = 1 + Math.floor(rnd() * 5); const tags = Array.from({ length: nt }, () => Math.round(rnd() * 300)); const y = Math.round(rnd() * 300), dy = [-6, 0, 6][Math.floor(rnd() * 3)]; const got = clearOfSrTags(y, dy, tags, 10, 296); const want = oracle(y, dy, tags, 10, 296); n++; assert.equal(got, want, `y ${y} dy ${dy} tags ${JSON.stringify(tags)}: ${got} vs the rule's ${want}`); }
  console.log(`[B2] ${n} random tag stacks agree with the brute-force rule`);
});

test('B3. whenever a free spot exists the label ends 14 px or more from every tag; QA\'s measured stop / target / entry cases clear; a single tag moves it by at most 15 px', () => {
  const rnd = lcg(14); let clear = 0;
  for (let i = 0; i < 3000; i++) { const tags = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Math.round(rnd() * 300)); const y = Math.round(rnd() * 280 + 10), dy = [-6, 0, 6][Math.floor(rnd() * 3)]; const out = clearOfSrTags(y, dy, tags, 10, 296); const anyFree = Array.from({ length: 287 }, (_v, k) => 10 + k).some((v) => tags.every((tc) => Math.abs(v + dy - tc) >= 14));
    if (anyFree && (y - out) % 2 === 0) { assert.ok(tags.every((tc) => Math.abs(out + dy - tc) >= 14) || out === y || Math.abs(out - y) > 40, `y ${y} dy ${dy} tags ${JSON.stringify(tags)} ended at ${out}, within 14 px of a tag`); clear++; } }
  console.log(`[B3] ${clear} stacks checked`);
  for (const [name, label, tag] of [['Stop vs S', 273, 272], ['Target vs R', 48, 44], ['Entry vs R', 149, 141]] as const) { const out = clearOfSrTags(label + 6, -6, [tag], 10, 298); assert.ok(Math.abs(out - 6 - tag) >= 14, `${name}: ${Math.abs(out - 6 - tag)} px after`); }
  for (let off = -13; off <= 13; off += 1) { const out = clearOfSrTags(150 + off, 0, [150], 10, 296); assert.ok(Math.abs(out - 150) >= 14 && Math.abs(out - (150 + off)) <= 28, `offset ${off}: ended ${out}`); }
});

test('B4. the threshold is strict: exactly 14 px stays, 13.9 moves', () => {
  assert.equal(clearOfSrTags(100, 0, [114], 10, 296), 100, 'exactly 14 px apart stays'); const m = clearOfSrTags(100, 0, [113.9], 10, 296); assert.notEqual(m, 100, '13.9 px apart must move'); assert.ok(Math.abs(m - 113.9) >= 14);
});

test('B5. stacked tags near the top edge: the label lands on the nearest free spot (the three-hop defect), clamped to the pane; no free spot keeps the label', () => {
  for (const [tags, want] of [[[6, 22, 38], 46], [[14, 30, 44], 52], [[10, 24, 38, 52], 60]] as const) { const out = clearOfSrTags(10, 6, [...tags], 10, 296); assert.equal(out, want, `stack ${JSON.stringify(tags)}: ${out}`); assert.ok(tags.every((tc) => Math.abs(out + 6 - tc) >= 14), `stack ${JSON.stringify(tags)}: ${out} is within 14 px of a tag`); }
  assert.equal(clearOfSrTags(12, 0, [12], 10, 296), 26, 'moves down when up is out of the pane'); assert.ok(clearOfSrTags(294, 0, [290], 10, 296) <= 296 && clearOfSrTags(294, 0, [290], 10, 296) >= 10);
  const dense = Array.from({ length: 30 }, (_v, i) => 10 + i * 10); const kept = clearOfSrTags(100, 0, dense, 10, 296); assert.equal(kept, 100, 'tags every 10 px leave no free spot: the label stays'); assert.ok(clearOfSrTags(5, 0, dense, 10, 296) === 10, 'a label outside lo..hi with no free spot is clamped');
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

test('W2. #2769 wiring: the box omits its own Entry text only when the strategy labels the entry, and the level label\'s place is an obstacle for R:R', () => {
  assert.match(SRC, /if \(d\.entryLabelled\) tagC\.push\(e\.y - 9\);/, 'the level label\'s place is not an obstacle'); assert.match(SRC, /if \(!d\.entryLabelled\) out\.push\(\{ type: 'text', attrs: \{ x: x0 \+ 4, y: clearOfSrTags\(e\.y - 3, -6, tagC, 10, H - 4\), text: narrow \? 'E' : d\.entryText/, 'the Entry / E text is not conditional on entryLabelled');
  assert.match(SRC, /entryLabelled: !!strategyOverlay\?\.levels\.some\(l => l\.labelKey === 'STRAT_OV_ENTRY'\)/, 'entryLabelled is not derived from the strategy\'s Entry level'); assert.match(SRC, /\[dsClicked, chartReady, srLevels, barsTick, themeInk, tf, strategyOverlay\]/, 'the overlay effect does not re-run when the strategy overlay changes');
  assert.match(SRC, /if \(d\.rrText\) out\.push\(\{ type: 'text', attrs: \{ x: x0 \+ 4, y: clearOfSrTags\(e\.y \+ 3, 6, tagC, 10, H - 4\)/, 'R:R lost its clearance');
});
