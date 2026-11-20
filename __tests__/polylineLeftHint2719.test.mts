/* QA: PR #2719, a strategy line wholly left of the visible candles still shows an edge hint, and the VWAP reclaim reads 1000 candles (QA drawings audit R4, #1263: XAU 1h at 390 px, the channel and RSI divergence swing lines lay left of the pane with no hint; AAPL / TSLA 1m had the last cash session outside the 300-candle window).
 *
 * THE WRITTEN RULES: a strategy polyline wholly left of the window (every point x < 0) and not wholly above / below the price window draws ONE text label "← <text>" at the left edge (x 4), at the LAST point's height clamped to [10, paneHeight - 10], left aligned, baseline middle.
 * Wholly above / below the price window keeps its up / down arrow at the right edge (NOT the left hint), also when it is wholly left too. A line with any point inside (x >= 0) is drawn as a line as before. One point left also hints. No points -> nothing.
 * The vwap_reclaim candle window is 1000 (1m reaches about 16 h so the last US cash session is inside), and the hook that fetches reads `def.candleLimit ?? 300` so the number reaches the fetch.
 *
 * WHAT RUNS: the REAL createPointFigures of `registerOverlay({ name: 'strategyPolyline' })` is cut out of components/KLineProChart.tsx (brace matching), its types stripped, and called with synthetic coordinates, a bounding box and extendData. roleInk / labelStyles are
 * recording stand-ins (the colour is not the rule here, which ink goes with which role is). Expectations are literal numbers from the rules above, never copied from the code under test.
 *   L1  wholly left, mid-window: one text figure "← label" at x 4, y = the last point's y, left aligned, middle baseline, no line
 *   L2  the y clamp: last y 3 -> 10, paneH-3 -> paneH-10, in range -> unchanged, the edges 10 and paneH-10 stay; the same at a 460 px tall pane
 *   L3  it uses the LAST point's y, not the first, nor the mean, nor the highest
 *   L4  wholly left AND wholly above: the up arrow at the right edge, no left hint; wholly left AND wholly below: the down arrow
 *   L5  a point inside (x >= 0, also exactly 0) is a line as before, no left hint; a line half in view keeps its end label at end.x + 4
 *   L6  one point left hints; one point inside is the text tag only
 *   L7  no points -> []; only non-finite points -> []; non-finite points are filtered before the rule (a NaN point cannot count as "inside" nor hide the hint)
 *   L8  slot offsets for the wholly above / below arrows are unchanged (17 px per slot from 12 px), right aligned at width - 6; the arrow glyphs
 *   L9  no bounding box: the pane is taken as 300 tall (clamp to 290) and the right edge 9999
 *   L10 the hint carries the line's own role ink (roleInk(role) through labelStyles)
 *   L11 VWAP_RECLAIM.candleLimit is 1000 and lib/useStrategySignal.ts fetches `def.candleLimit ?? 300`
 * WHAT THIS CANNOT PROVE: the pixel position on a real 390 px chart, that klinecharts hands this function those coordinates (the browser run after promotion), or that the label is readable over the candles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { VWAP_RECLAIM } from '../lib/strategies/vwapReclaim.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function braceEnd(from: number): number {
  let depth = 0, i = from, inStr: string | null = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; continue; }
    if (c === '/' && n === '*') { inBlock = true; continue; }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) break; }
  }
  return i;
}
function cutCreatePointFigures(name: string): string {
  const at = src.indexOf(`name: '${name}'`);
  assert.ok(at >= 0, `no registerOverlay name '${name}' in KLineProChart.tsx`);
  const fnAt = src.indexOf('createPointFigures:', at);
  assert.ok(fnAt > at, `no createPointFigures after '${name}'`);
  const arrow = src.indexOf('=>', fnAt);
  const open = src.indexOf('{', arrow);
  return src.slice(fnAt + 'createPointFigures:'.length, braceEnd(open) + 1).trim();
}

type Pt = { x: number; y: number };
type Fig = { type: string; attrs: { x?: number; y?: number; text?: string; align?: string; baseline?: string; coordinates?: Pt[] }; styles: Record<string, unknown> };
type Fn = (a: { overlay: { extendData: { role: string; text: string; slot?: number } }; coordinates: Pt[]; bounding?: { width: number; height: number } }) => Fig[];

const cut = cutCreatePointFigures('strategyPolyline');
const roleInk = (role: string) => `ink(${role})`;
const labelStyles = (ink: string) => ({ label: true, ink });
const fn = new Function('roleInk', 'labelStyles', `return (${stripTypeScriptTypes(`const __x = ${cut};`).replace(/^const __x = /, '').replace(/;\s*$/, '')})`)(roleInk, labelStyles) as Fn;

const W = 307, H = 400;
const draw = (coordinates: Pt[], text = 'Channel', opts: { role?: string; slot?: number; bounding?: { width: number; height: number } | null } = {}) =>
  fn({ overlay: { extendData: { role: opts.role ?? 'confirm', text, slot: opts.slot } }, coordinates, bounding: opts.bounding === null ? undefined : (opts.bounding ?? { width: W, height: H }) });

test('L1. wholly left, mid-window: one "← label" text at x 4, at the last y, no line', () => {
  const out = draw([{ x: -80, y: 120 }, { x: -20, y: 200 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'text');
  assert.equal(out[0].attrs.text, '← Channel');
  assert.equal(out[0].attrs.x, 4);
  assert.equal(out[0].attrs.y, 200);
  assert.equal(out[0].attrs.align, 'left');
  assert.equal(out[0].attrs.baseline, 'middle');
  assert.ok(!out.some((f) => f.type === 'line'), 'a line was drawn for a line that is wholly off the left');
});

test('L2. the y clamp: [10, paneH - 10]', () => {
  const y = (last: number, h = H) => draw([{ x: -50, y: 150 }, { x: -5, y: last }], 'Ln', { bounding: { width: W, height: h } })[0].attrs.y;
  assert.equal(y(3), 10);
  assert.equal(y(0), 10);
  assert.equal(y(H - 3), H - 10);   // 397 -> 390
  assert.equal(y(H), H - 10);       // exactly on the bottom edge of the pane: wholeBelow is false (y > H is the rule), the hint clamps
  assert.equal(y(250), 250);
  assert.equal(y(10), 10);
  assert.equal(y(H - 10), H - 10);
  assert.equal(y(11), 11);
  assert.equal(y(H - 11), H - 11);
  assert.equal(y(457, 460), 450);
  assert.equal(y(2, 460), 10);
  assert.equal(y(230, 460), 230);
});

test('L3. the LAST point sets the height, not the first, the mean or the highest', () => {
  const a = draw([{ x: -90, y: 50 }, { x: -60, y: 90 }, { x: -10, y: 300 }]);
  assert.equal(a[0].attrs.y, 300);
  const b = draw([{ x: -90, y: 300 }, { x: -60, y: 90 }, { x: -10, y: 50 }]);
  assert.equal(b[0].attrs.y, 50);
  const c = draw([{ x: -90, y: 5 }, { x: -10, y: 120 }]);   // the first would clamp to 10, the last is 120
  assert.equal(c[0].attrs.y, 120);
});

test('L4. wholly left AND wholly above keeps the up arrow; wholly left AND wholly below keeps the down arrow', () => {
  const up = draw([{ x: -80, y: -40 }, { x: -20, y: -10 }], 'Channel');
  assert.equal(up.length, 1);
  assert.equal(up[0].attrs.text, 'Channel ↑');
  assert.equal(up[0].attrs.x, W - 6);
  assert.equal(up[0].attrs.align, 'right');
  assert.equal(up[0].attrs.baseline, 'top');
  assert.equal(up[0].attrs.y, 12);
  const down = draw([{ x: -80, y: H + 30 }, { x: -20, y: H + 60 }], 'Channel');
  assert.equal(down.length, 1);
  assert.equal(down[0].attrs.text, 'Channel ↓');
  assert.equal(down[0].attrs.x, W - 6);
  assert.equal(down[0].attrs.align, 'right');
  assert.equal(down[0].attrs.baseline, 'bottom');
  assert.equal(down[0].attrs.y, H - 12);
  for (const f of [...up, ...down]) assert.ok(!String(f.attrs.text).includes('←'), 'a wholly above/below line got the left hint');
  // one point above and one below the window is NOT wholly above or below: it hints on the left
  const split = draw([{ x: -80, y: -40 }, { x: -20, y: H + 40 }]);
  assert.equal(split[0].attrs.text, '← Channel');
  assert.equal(split[0].attrs.y, H - 10);
});

test('L5. any point inside (x >= 0) is drawn as a line as before, with no left hint', () => {
  const pts = [{ x: -40, y: 100 }, { x: 60, y: 140 }];
  const out = draw(pts);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'line');
  assert.deepEqual(out[0].attrs.coordinates, pts);
  assert.equal(out[1].type, 'text');
  assert.equal(out[1].attrs.text, 'Channel');
  assert.equal(out[1].attrs.x, 64);
  assert.equal(out[1].attrs.y, 140);
  assert.equal(out[1].attrs.baseline, 'middle');
  // the first point inside, the last left of it: still not wholly left
  const rev = draw([{ x: 30, y: 100 }, { x: -50, y: 140 }]);
  assert.equal(rev[0].type, 'line');
  assert.ok(!rev.some((f) => String(f.attrs.text).includes('←')));
  // x exactly 0 is on the left edge of the candles, inside
  const edge = draw([{ x: -60, y: 100 }, { x: 0, y: 160 }]);
  assert.equal(edge[0].type, 'line');
  assert.ok(!edge.some((f) => String(f.attrs.text).includes('←')));
  // a hair left of 0 is wholly left
  const hair = draw([{ x: -60, y: 100 }, { x: -0.5, y: 160 }]);
  assert.equal(hair.length, 1);
  assert.equal(hair[0].attrs.text, '← Channel');
});

test('L6. one point left hints; one point inside is the text tag only', () => {
  const one = draw([{ x: -12, y: 77 }], 'VWAP');
  assert.equal(one.length, 1);
  assert.equal(one[0].attrs.text, '← VWAP');
  assert.equal(one[0].attrs.x, 4);
  assert.equal(one[0].attrs.y, 77);
  const inside = draw([{ x: 120, y: 77 }], 'VWAP');
  assert.equal(inside.length, 1);
  assert.equal(inside[0].type, 'text');
  assert.equal(inside[0].attrs.text, 'VWAP');
  assert.equal(inside[0].attrs.x, 124);
  assert.equal(inside[0].attrs.y, 77);
});

test('L7. no points -> []; only non-finite points -> []; non-finite points are filtered before the rule', () => {
  assert.deepEqual(draw([]), []);
  assert.deepEqual(draw([{ x: NaN, y: 10 }, { x: 5, y: Infinity }]), []);
  assert.deepEqual(draw([undefined as unknown as Pt, null as unknown as Pt]), []);
  // a NaN point does not count as "inside" and does not hide the hint; the last FINITE point sets the height
  const mixed = draw([{ x: -70, y: 140 }, { x: NaN, y: 20 }, { x: -10, y: 220 }, { x: 50, y: NaN }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].attrs.text, '← Channel');
  assert.equal(mixed[0].attrs.y, 220);
  // a non-finite y does not make the line "wholly above" either
  const nanY = draw([{ x: -70, y: NaN }, { x: -10, y: 180 }]);
  assert.equal(nanY[0].attrs.text, '← Channel');
  assert.equal(nanY[0].attrs.y, 180);
});

test('L8. the wholly above / below arrows keep their slot offsets (17 px per slot) and glyphs', () => {
  const above = (slot?: number) => draw([{ x: 5, y: -30 }, { x: 80, y: -5 }], 'RSI', { slot })[0];
  const below = (slot?: number) => draw([{ x: 5, y: H + 30 }, { x: 80, y: H + 5 }], 'RSI', { slot })[0];
  assert.equal(above().attrs.y, 12);
  assert.equal(above(0).attrs.y, 12);
  assert.equal(above(1).attrs.y, 29);
  assert.equal(above(3).attrs.y, 63);
  assert.equal(below().attrs.y, H - 12);
  assert.equal(below(1).attrs.y, H - 29);
  assert.equal(below(3).attrs.y, H - 63);
  assert.equal(above(2).attrs.text, 'RSI ↑');
  assert.equal(below(2).attrs.text, 'RSI ↓');
  assert.equal(above(2).attrs.x, W - 6);
  assert.equal(above(2).attrs.align, 'right');
  assert.equal(below(2).attrs.baseline, 'bottom');
  assert.equal(above(2).attrs.baseline, 'top');
  // the left hint has no slot: two lines stack at their own heights, not at an offset
  const left = draw([{ x: -50, y: 100 }, { x: -10, y: 100 }], 'RSI', { slot: 3 });
  assert.equal(left[0].attrs.y, 100);
});

test('L9. no bounding box: pane taken as 300 tall (clamp to 290) and 9999 wide', () => {
  const left = draw([{ x: -50, y: 100 }, { x: -10, y: 295 }], 'Ln', { bounding: null });
  assert.equal(left[0].attrs.text, '← Ln');
  assert.equal(left[0].attrs.y, 290);
  const above = draw([{ x: 5, y: -30 }, { x: 80, y: -5 }], 'Ln', { bounding: null });
  assert.equal(above[0].attrs.x, 9993);
  const below = draw([{ x: 5, y: 330 }, { x: 80, y: 340 }], 'Ln', { bounding: null });
  assert.equal(below[0].attrs.y, 288);
});

test('L10. the hint carries the line\'s own role ink', () => {
  const pts = [{ x: -50, y: 100 }, { x: -10, y: 140 }];
  assert.deepEqual(draw(pts, 'Ln', { role: 'invalid' })[0].styles, { label: true, ink: 'ink(invalid)' });
  assert.deepEqual(draw(pts, 'Ln', { role: 'ref' })[0].styles, { label: true, ink: 'ink(ref)' });
  assert.deepEqual(draw(pts, 'Ln', { role: 'confirm' })[0].styles, { label: true, ink: 'ink(confirm)' });
});

test('L11. the vwap_reclaim window is 1000 candles and the fetch reads it', () => {
  assert.equal(VWAP_RECLAIM.candleLimit, 1000);
  const hook = readFileSync(new URL('../lib/useStrategySignal.ts', import.meta.url), 'utf8');
  assert.match(hook, /fetchOHLCV\([^)]*def\.candleLimit \?\? 300\)/, 'useStrategySignal no longer passes def.candleLimit ?? 300 to the fetch, so the 1000 never reaches it');
});
