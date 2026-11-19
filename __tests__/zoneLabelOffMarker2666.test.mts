import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2666 (#1263 box 91): THE SUPPLY / DEMAND ZONE LABEL DOES NOT COVER THE BUY / SELL MARKER. Written rule (PR body): the marker is on the PRICE side of the zone (a long's triangle is below the signal candle's low, just above a demand zone's top edge; a short's is above the candle's high, just below a supply zone's bottom edge), so the label moves to the FAR edge: demand = under the bottom edge, supply = above the top edge, both still right-aligned (x1 - 4), and S/R bands (no text) are unchanged.
 * The real strategyZone createPointFigures is cut out of components/KLineProChart.tsx and run on chosen pixel positions; the label is a 10px-high rectangle with an estimated 6px per character; the marker is a 18px-high zone of triangle on the price side of the edge.
 *   Z1 demand label is under the bottom edge, baseline top, and never intersects the marker area above the top edge, for every zone height from 1 to 300 px
 *   Z2 supply label is above the top edge, baseline bottom, and never intersects the marker area below the bottom edge
 *   Z3 right-aligned at x1 - 4 in both, clamped to the pane width; the zone rectangle itself is unchanged (x0, y0, width, height at least 1)
 *   Z4 CONTROL: the OLD placement (demand above the top edge) does overlap the marker in this model, so the test can fail
 *   Z5 DIAGNOSTIC: a supply zone whose top edge is within 13 px of the pane top puts its label above the pane (printed, not asserted: needs a browser cell) */
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/* #2688: the zone figure now also reads priceText / slot and draws an OFF-WINDOW label at the pane edge (pinned in zoneInViewLabel2688); this test still pins the in-window placement, so it cuts from the new first line. */
const start = src.indexOf("const { kind, text, priceText, slot } = overlay.extendData as { kind: 'supply' | 'demand'; text: string; priceText?: string; slot?: number };"); assert.ok(start > 0, 'CONTROL: the zone figure code was not found');
const end = src.indexOf('];\n', src.indexOf("{ type: 'text', attrs: { x: x1 - 4, y: demand", start)); assert.ok(end > start, 'CONTROL: the end of the figure list was not found');
const body = src.slice(start, end + 2).replace(/ as \{[^}]*\}/g, '');   // the one TypeScript assertion in the slice
const figures = new Function('overlay', 'coordinates', 'bounding', 'resolveCssColor', 'withAlpha', 'isFinite', `${body}`) as (o: unknown, c: unknown, b: unknown, r: (s: string) => string, w: (c: string, a: number) => string, f: (n: number) => boolean) => Array<{ type: string; attrs: Record<string, number | string>; styles?: unknown }>;
const zone = (kind: 'demand' | 'supply', y0: number, h: number, x0 = 40, x1 = 300, text = kind === 'demand' ? 'Demand' : 'Supply') => figures({ extendData: { kind, text } }, [{ x: x0, y: y0 }, { x: x1, y: y0 + h }], { width: 400 }, (s: string) => s, (c: string) => c, Number.isFinite);
const label = (f: ReturnType<typeof zone>) => f.find((x) => x.type === 'text')!;
const rect = (f: ReturnType<typeof zone>) => f.find((x) => x.type === 'rect')!;
const box = (l: { attrs: Record<string, number | string> }) => { const w = String(l.attrs.text).length * 6, x = Number(l.attrs.x) - w, y = l.attrs.baseline === 'top' ? Number(l.attrs.y) : Number(l.attrs.y) - 10; return { x0: x, x1: x + w, y0: y, y1: y + 10 }; };
const hit = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const markerAt = (kind: 'demand' | 'supply', y0: number, h: number) => (kind === 'demand' ? { x0: 250, x1: 300, y0: y0 - 18, y1: y0 } : { x0: 250, x1: 300, y0: y0 + h, y1: y0 + h + 18 });   // price side of the zone, under the label's right end

test('Z1. demand: the label is under the bottom edge and never meets the marker above the top edge', () => {
  for (const h of [1, 2, 5, 10, 25, 60, 120, 300]) for (const y0 of [60, 120, 300]) {
    const f = zone('demand', y0, h), l = label(f); assert.equal(l.attrs.baseline, 'top', 'demand label baseline'); assert.equal(Number(l.attrs.y), y0 + Math.max(h, 1) + 3, `h ${h}: the label is not 3px under the bottom edge`);
    assert.equal(hit(box(l), markerAt('demand', y0, h)), false, `demand h ${h} y0 ${y0}: the label covers the Buy marker`);
  }
});
test('Z2. supply: the label is above the top edge and never meets the marker below the bottom edge', () => {
  for (const h of [1, 2, 5, 10, 25, 60, 120, 300]) for (const y0 of [60, 120, 300]) {
    const f = zone('supply', y0, h), l = label(f); assert.equal(l.attrs.baseline, 'bottom', 'supply label baseline'); assert.equal(Number(l.attrs.y), y0 - 3, `h ${h}: the label is not 3px above the top edge`);
    assert.equal(hit(box(l), markerAt('supply', y0, h)), false, `supply h ${h} y0 ${y0}: the label covers the Sell marker`);
  }
});
test('Z3. right-aligned at x1 - 4 (clamped to the pane), the zone rectangle unchanged', () => {
  for (const kind of ['demand', 'supply'] as const) { const f = zone(kind, 100, 40), l = label(f), r = rect(f); assert.equal(l.attrs.align, 'right'); assert.equal(l.attrs.x, 300 - 4); assert.deepEqual([r.attrs.x, r.attrs.y, r.attrs.width, r.attrs.height], [40, 100, 260, 40]);
    const wide = label(zone(kind, 100, 40, 40, 9999)); assert.equal(wide.attrs.x, 400 - 4, 'the right end must be clamped to the pane width'); assert.equal(rect(zone(kind, 100, 0)).attrs.height, 1, 'a zero-height zone still draws 1px'); }
  assert.deepEqual(zone('demand', 100, 40, 300, 300), [], 'a zone with no width draws nothing');
});
test('Z4. CONTROL: the old placement (demand label above the top edge) does cover the marker in this model', () => {
  const y0 = 120, h = 40; const old = { attrs: { x: 296, y: y0 - 3, text: 'Demand', baseline: 'bottom' } }; assert.equal(hit(box(old), markerAt('demand', y0, h)), true, 'the model no longer detects the overlap it was written for');
});
test('Z5. DIAGNOSTIC: labels that fall outside a pane of 400 px height', () => {
  const out: string[] = []; for (const [kind, y0, h] of [['supply', 8, 20], ['demand', 380, 12], ['supply', 14, 20]] as const) { const b = box(label(zone(kind, y0, h))); if (b.y0 < 0 || b.y1 > 400) out.push(`${kind} y0=${y0} h=${h}: label ${b.y0}..${b.y1}`); }
  console.log(`[Z] labels outside the pane: ${out.join(' | ') || 'none'}`);
});
