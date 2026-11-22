import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

/* #2700 (QA drawings audit #1263 wave 1 on qa 6576e45, 390 px 4h: ema_cross BTC EMA 50/200 above the visible price window and nothing in view; range_bounce ETH levels off-window; fvg box older than the candles in view). Written rule (PR body): a strategy LEVEL LINE wholly above/below the visible price window still shows its label with its price and an arrow (up/down) at the pane edge it lies beyond, stacked with the other off-window labels on that edge (lines first, then levels in price order); a strategy POLYLINE wholly above/below does the same; a ZONE that ENDS left of the visible candles shows "<- label price" at the left edge at the zone's height; everything in view is drawn as before; a point that is not finite draws nothing.
 *   H1 level line (real figure code cut from components/KLineProChart.tsx, run on pixel positions)   H2 polyline   H3 zone left of the candles   H4 nothing is drawn at the wrong place: in-window levels keep their line, no hint
 * NOT covered (browser cells after deploy): readability of the hints over the real chart at 390 and the fvg box actually being left of the view in the BTC/ETH 4h cell. */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** the arrow function after `createPointFigures:` of the overlay registered under `name`, cut by matching braces */
function figureFn(name: string): string {
  const at = src.indexOf(`name: '${name}',`); assert.ok(at > 0, `CONTROL: overlay ${name} not found`); const cp = src.indexOf('createPointFigures:', at); assert.ok(cp > at, `CONTROL: createPointFigures of ${name} not found`);
  const arrow = src.indexOf('=> {', cp); let depth = 0, i = arrow + 3; for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; } }
  const head = src.slice(cp + 'createPointFigures:'.length, arrow + 3).trim(); return stripTypeScriptTypes(`const f = ${head}${src.slice(arrow + 3, i + 1)};`).replace(/^const f = /, 'return ').replace(/\/\/ eslint-disable[^\n]*\n/g, '');
}
type Fig = { type: string; attrs: Record<string, unknown>; styles?: Record<string, unknown> };
const stand = { roleInk: (r: string) => `ink:${r}`, labelStyles: (ink: string) => ({ ink }), resolveCssColor: (s: string) => `css:${s}`, withAlpha: (c: string) => c, solidTint: (c: string) => c };
/* #2761: the overlays read srTagCenters / clearOfSrTags / srTagPricesRef from the component's scope. The REAL helpers are cut out of the same file and the S/R layer is OFF here (no tag prices), so every label sits exactly where it did before the PR: this file keeps judging the edge hints, not the tag clearance (that is __tests__/srTagClearance2761.test.mts). */
const cutBlock = (re: RegExp): string => { const m = re.exec(src); assert.ok(m, `CONTROL: ${re} not found`); let i = src.indexOf('{', m.index + m[0].length - 1), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) break; } } return src.slice(m.index, i + 1); };
const srHelpers = new Function(`${stripTypeScriptTypes(`const SR_TAG_APART_PX = ${/const SR_TAG_APART_PX = (\d+);/.exec(src)![1]};\n${cutBlock(/function srTagCenters\(/)}\n${cutBlock(/function clearOfSrTags\(/)}`)}\nreturn { srTagCenters, clearOfSrTags };`)() as { srTagCenters: unknown; clearOfSrTags: unknown };
const make = (name: string) => { const fn = new Function('roleInk', 'labelStyles', 'resolveCssColor', 'withAlpha', 'solidTint', 'chartRef', 'isFinite', 'srTagCenters', 'clearOfSrTags', 'srTagPricesRef', figureFn(name)); return (...a: unknown[]) => (fn as (...x: unknown[]) => unknown)(...a, srHelpers.srTagCenters, srHelpers.clearOfSrTags, { current: [] }); };
const PANE = { width: 390, height: 300 };
const level = (price: number, y: number, ex: Record<string, unknown> = {}, others: Record<number, number> = {}) => { const chartRef = { current: { convertToPixel: ({ value }: { value: number }) => [{ y: others[value] ?? NaN }] } }; const f = make('strategyLevelLine')(stand.roleInk, stand.labelStyles, stand.resolveCssColor, stand.withAlpha, stand.solidTint, chartRef, Number.isFinite) as (a: unknown) => Fig[]; return f({ overlay: { extendData: { role: 'watch', text: `L${price}`, ...ex } }, coordinates: [{ x: 50, y }], bounding: PANE }); };
const poly = (ys: number[], ex: Record<string, unknown> = {}) => { const f = make('strategyPolyline')(stand.roleInk, stand.labelStyles, stand.resolveCssColor, stand.withAlpha, stand.solidTint, { current: null }, Number.isFinite) as (a: unknown) => Fig[]; return f({ overlay: { extendData: { role: 'watch', text: 'P', ...ex } }, coordinates: ys.map((y, i) => ({ x: 30 + i * 40, y })), bounding: PANE }); };
const zoneFn = () => make('strategyZone')(stand.roleInk, stand.labelStyles, stand.resolveCssColor, stand.withAlpha, stand.solidTint, { current: null }, Number.isFinite) as (a: unknown) => Fig[];
const zone = (ax: number, bx: number, ay: number, by: number, ex: Record<string, unknown> = {}) => zoneFn()({ overlay: { extendData: { kind: 'demand', text: 'FVG', priceText: '$70,100', ...ex } }, coordinates: [{ x: ax, y: ay }, { x: bx, y: by }], bounding: PANE });
const texts = (f: Fig[]) => f.filter((x) => x.type === 'text');

test('H1. a level line off the price window shows its label with its price and an arrow at the edge it lies beyond; stacked; in-window levels keep their line and get no hint', () => {
  const above = level(74_000, -80, { text: 'EMA 200 $73,967' }); assert.equal(above.length, 1, 'an off-window level draws only its hint'); assert.equal(above[0].attrs.text, 'EMA 200 $73,967 ↑'); assert.equal(above[0].attrs.y, 12, 'above: at the top edge'); assert.equal(above[0].attrs.baseline, 'top'); assert.equal(above[0].attrs.x, PANE.width - 6); assert.equal(above[0].attrs.align, 'right');
  const below = level(60_000, 380, { text: 'Support $60,100' }); assert.equal(below[0].attrs.text, 'Support $60,100 ↓'); assert.equal(below[0].attrs.y, PANE.height - 12, 'below: at the bottom edge'); assert.equal(below[0].attrs.baseline, 'bottom');
  /* stacking: two levels beyond the top edge: the lower-priced one (rank 0) sits first, the next one 17 px down (rank 1 counts the off-window levels below it) */
  const prices = [66_724, 73_967]; const r0 = level(66_724, -150, { prices, rank: 0, text: 'EMA 50' }, { 73_967: -40 }), r1 = level(73_967, -40, { prices, rank: 1, text: 'EMA 200' }, { 66_724: -150 });
  assert.equal(r0[0].attrs.y, 12, 'rank 0: first slot'); assert.equal(r1[0].attrs.y, 12 + 17, 'rank 1 with one off-window level below it: the second slot, 17 px down');
  const slotBase = level(74_000, -80, { slotBase: 2 }); assert.equal(slotBase[0].attrs.y, 12 + 2 * 17, 'lines drawn before the levels push them down by their count');
  const b0 = level(59_000, 400, { prices: [59_000, 60_000], rank: 0, text: 'B0' }, { 60_000: 350 }), b1 = level(60_000, 350, { prices: [59_000, 60_000], rank: 1, text: 'B1' }, { 59_000: 400 }); assert.equal(b0[0].attrs.y, PANE.height - 12, 'bottom edge, first slot'); assert.equal(b1[0].attrs.y, PANE.height - 12 - 17, 'the second below-window level stacks upward, 17 px');
  /* in window: the line is drawn, no arrow hint */
  const inView = level(70_000, 120, { text: 'EMA 50 $70,000' }); assert.ok(inView.some((f) => f.type === 'line'), 'an in-window level keeps its line'); assert.equal(texts(inView).some((t) => /[↑↓]/.test(String(t.attrs.text))), false, 'an in-window level gets no edge hint');
  for (const y of [0, 300]) assert.ok(level(70_000, y).some((f) => f.type === 'line'), `a level exactly at y=${y} is on the window edge, in view`);
  assert.deepEqual(level(70_000, NaN), [], 'a non-finite position draws nothing');
});
test('H2. a polyline wholly above or below the window shows its label with an arrow at the edge (slot-stacked); a polyline that touches the window is drawn as before', () => {
  const up = poly([-60, -70, -90], { text: 'Swing high', slot: 0 }); assert.equal(up.length, 1); assert.equal(up[0].attrs.text, 'Swing high ↑'); assert.equal(up[0].attrs.y, 12); const up1 = poly([-60, -70], { text: 'Swing low', slot: 1 }); assert.equal(up1[0].attrs.y, 12 + 17, 'the next line takes the next slot');
  const down = poly([320, 340], { text: 'Swing low', slot: 0 }); assert.equal(down[0].attrs.text, 'Swing low ↓'); assert.equal(down[0].attrs.y, PANE.height - 12); assert.equal(down[0].attrs.baseline, 'bottom');
  const crossing = poly([-30, 120, 200]); assert.ok(crossing.some((f) => f.type === 'line'), 'a line that enters the window is drawn'); assert.equal(texts(crossing).some((t) => /[↑↓]/.test(String(t.attrs.text))), false);
  const mixed = poly([-30, 150]); assert.ok(mixed.some((f) => f.type === 'line'), 'one point inside keeps the whole line');
  assert.equal(poly([]).length, 0, 'no points: nothing');
});
test('H3. a zone that ends LEFT of the visible candles shows "<- label price" at the left edge at its height; in view it is drawn as before; right of the pane or with no label it draws nothing extra', () => {
  const left = zone(-120, -10, 100, 140); assert.equal(left.length, 1, 'only the hint'); assert.equal(left[0].attrs.text, '← FVG $70,100'); assert.equal(left[0].attrs.x, 4); assert.equal(left[0].attrs.align, 'left'); assert.equal(left[0].attrs.y, 120, 'at the zone\'s mid height');
  const nearTop = zone(-120, -10, -5, 20); assert.ok(Number(nearTop[0].attrs.y) >= 10, 'the hint stays inside the pane at the top'); const nearBottom = zone(-120, -10, 290, 330); assert.ok(Number(nearBottom[0].attrs.y) <= PANE.height - 10, 'and at the bottom');
  assert.deepEqual(zone(-120, -10, 100, 140, { text: '' }), [], 'an unlabelled zone left of the view draws nothing (S/R bands)'); assert.deepEqual(zone(420, 500, 100, 140), [], 'a zone right of the pane draws nothing');
  const inView = zone(40, 300, 100, 140); assert.ok(inView.some((f) => f.type === 'rect'), 'a zone in view keeps its rectangle'); assert.equal(texts(inView).some((t) => String(t.attrs.text).startsWith('←')), false, 'no left hint for a zone in view');
});
