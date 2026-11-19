import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fvgFixture } from '../qa/fixtures/strategyFixtures.ts';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { withWatchedDrawing } from '../lib/strategies/chartDrawings.ts';

/* #2688 (QA drawings audit #1263: at 390 px a supply zone sat above the visible prices so the strategy drew nothing in view; fvg 1h with no open gap drew only arrows and no box). Written rule (PR body): a LABELLED strategy zone that lies wholly above or below the visible price window still shows its label, its price and an arrow at the pane edge it lies beyond (the same idea as the Target / Stop labels); several off-window zones stack 12 px apart (their slot); an UNLABELLED zone (the S/R bands) and an in-window zone are unchanged; a fair value gap strategy with no open gap says "No open gap: every recent gap has been returned to or filled." instead of a bare wait.
 *   Z6 the real strategyZone figure code (cut from components/KLineProChart.tsx) for in-window, above-the-pane, below-the-pane, stacked and unlabelled zones   F1 the real withWatchedDrawing for fvg: an open gap is drawn, no open gap is marked none and says so, other strategies are untouched   F2 the label: registered, English in the defaults, the held migration equal for PROD/DEV in en/ko/zh/ru/ar
 * NOT covered (browser cells after deploy): that the edge label is readable over the real chart at 390 px. */
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf("const { kind, text, priceText, slot } = overlay.extendData as { kind: 'supply' | 'demand'; text: string; priceText?: string; slot?: number };"); assert.ok(start > 0, 'CONTROL: the zone figure code was not found');
const end = src.indexOf('];\n', src.indexOf("{ type: 'text', attrs: { x: x1 - 4, y: demand", start)); assert.ok(end > start, 'CONTROL: the end of the figure list was not found');
const body = src.slice(start, end + 2).replace(/ as \{[^}]*\}/g, '');
const figures = new Function('overlay', 'coordinates', 'bounding', 'resolveCssColor', 'withAlpha', 'isFinite', `${body}`) as (o: unknown, c: unknown, b: unknown, r: (s: string) => string, w: (c: string, a: number) => string, f: (n: number) => boolean) => Array<{ type: string; attrs: Record<string, number | string>; styles?: { color?: string } }>;
const PANE = { width: 400, height: 300 };
const zone = (kind: 'demand' | 'supply', y0: number, h: number, extra: { text?: string; priceText?: string; slot?: number } = {}) => figures({ extendData: { kind, text: 'text' in extra ? extra.text : kind === 'demand' ? 'Demand' : 'Supply', priceText: extra.priceText, slot: extra.slot } }, [{ x: 40, y: y0 }, { x: 300, y: y0 + h }], PANE, (s: string) => s, (c: string) => c, Number.isFinite);

test('Z6. an off-window labelled zone puts label + price + arrow at the pane edge; in-window and unlabelled zones are unchanged', () => {
  const above = zone('supply', -80, 30, { priceText: '$71,374' }); assert.equal(above.length, 1, 'an off-window zone draws only the edge label (no rectangle outside the pane)'); const a = above[0]; assert.equal(a.type, 'text'); assert.equal(a.attrs.text, 'Supply $71,374 ↑'); assert.equal(a.attrs.baseline, 'top'); assert.equal(a.attrs.y, 10, 'above: at the top edge'); assert.equal(a.attrs.x, 300 - 4); assert.equal(a.attrs.align, 'right');
  const below = zone('demand', 340, 30, { priceText: '$60,100' }); assert.equal(below.length, 1); const b = below[0]; assert.equal(b.attrs.text, 'Demand $60,100 ↓'); assert.equal(b.attrs.baseline, 'bottom'); assert.equal(b.attrs.y, PANE.height - 10, 'below: at the bottom edge');
  assert.equal(zone('supply', -80, 30)[0].attrs.text, 'Supply ↑', 'no price text: just the label and the arrow');
  const s0 = zone('supply', -80, 30, { slot: 0 })[0], s1 = zone('supply', -80, 30, { slot: 1 })[0], s2 = zone('supply', -80, 30, { slot: 2 })[0]; assert.deepEqual([s0.attrs.y, s1.attrs.y, s2.attrs.y], [10, 22, 34], 'stacked 12 px apart from the top edge'); const d1 = zone('demand', 340, 30, { slot: 1 })[0], d2 = zone('demand', 340, 30, { slot: 2 })[0]; assert.deepEqual([zone('demand', 340, 30, { slot: 0 })[0].attrs.y, d1.attrs.y, d2.attrs.y], [290, 278, 266], 'stacked 12 px apart from the bottom edge');
  const clamped = zone('supply', -80, 30, { slot: 99 })[0]; assert.ok(Number(clamped.attrs.y) <= PANE.height - 10, 'a high slot never leaves the pane');
  assert.ok(above[0].styles?.color, 'the edge label takes the zone colour');
  /* the boundary: touching the edge is still in-window */
  for (const [y0, h] of [[-30, 30], [0, 30], [270, 30], [300, 20]] as const) assert.ok(zone('supply', y0, h).some((f) => f.type === 'rect'), `a zone at y0=${y0} h=${h} touches the window and keeps its rectangle`);
  assert.equal(zone('supply', -80, 30, { text: '' }).some((f) => f.type === 'text' && /↑|↓/.test(String(f.attrs.text))), false, 'an UNLABELLED zone (S/R band) never gets an edge label');
  const inWin = zone('demand', 100, 40); assert.ok(inWin.some((f) => f.type === 'rect') && inWin.some((f) => f.type === 'text' && f.attrs.text === 'Demand'), 'an in-window zone keeps its rectangle and plain label');
});

const FVG = STRATEGIES.find((s) => s.id === 'fvg')!, ctx = { coin: 'BTC', tf: '1h', tfMs: 3_600_000 } as never;
const toOhlcv = (c: Array<Record<string, number>>) => c.map((x) => ({ time: x.timestamp ?? x.time, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume ?? 0 }));
test('F1. fvg: an open gap is drawn; no open gap is marked none and says so; the reason key only then; other strategies untouched', () => {
  const open = toOhlcv(fvgFixture('bull', false) as never), closed = toOhlcv(fvgFixture('bull', true, 1_760_000_000_000, 900, 1.2) as never);
  const waitOf = (c: ReturnType<typeof toOhlcv>) => { const r = FVG.detect(c, ctx); return { r, w: withWatchedDrawing(FVG, r, c, ctx) }; };
  const o = waitOf(open); if (o.r.verdict === 'wait') { assert.ok((o.w.overlay?.zones.length ?? 0) > 0, 'an open gap is drawn'); assert.equal(o.w.params.none, undefined, 'a drawn gap is not "none"'); assert.equal(FVG.reasonKeyFor!(o.w as never), null); }
  /* a plain WAIT with candles that hold no gap at all */
  const flat = Array.from({ length: 60 }, (_, i) => ({ time: 1_760_000_000_000 + i * 3_600_000, open: 100, high: 100.4, low: 99.6, close: 100 + (i % 2 ? 0.1 : -0.1), volume: 1 }));
  const none = withWatchedDrawing(FVG, { verdict: 'wait', params: {} } as never, flat, ctx); assert.equal(none.params.none, true, 'no gap at all: marked none'); assert.equal(FVG.reasonKeyFor!(none as never), 'STRAT_FVG_WAIT_NONE');
  void closed;
  const other = STRATEGIES.find((s) => s.id === 'ema_stack')!; const o2 = withWatchedDrawing(other, { verdict: 'wait', params: {} } as never, flat, ctx); assert.equal(o2.params.none, undefined, 'only fvg gets the none mark'); assert.equal(FVG.reasonKeyFor!({ params: {} } as never), null);
  const call = withWatchedDrawing(FVG, { verdict: 'buy', params: { entry: 1 }, signalDir: 'long', signalTimestamp: 1 } as never, flat, ctx); assert.equal(call.params.none, undefined, 'a call is never marked none'); assert.equal(call.verdict, 'buy');
});
test('F2. the label: registered, English in the defaults, the held migration equal for PROD and DEV in five locales', () => {
  const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>; const keys = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8'); const sql = readFileSync(new URL('../supabase/migrations/20261126c_labels_fvg_no_open_gap.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const k = 'STRAT_FVG_WAIT_NONE'; assert.equal(defaults[k], 'No open gap: every recent gap has been returned to or filled.'); assert.ok(keys.includes(`'${k}'`), `${k} not registered`);
  const prod = sql.slice(sql.indexOf('===== PROD ====='), sql.indexOf('===== DEV =====')), dev = sql.slice(sql.indexOf('===== DEV ====='));
  for (const [name, block, table] of [['PROD', prod, 'lhq_labels'], ['DEV', dev, 'lhq_dev_labels']] as const) { assert.ok(block.includes(`insert into ${table} (key, locale, value) values`), `${name}: wrong table`); for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) assert.ok(new RegExp(`\\('${k}','${loc}','[^']+'\\)`).test(block), `${name}: no ${loc} row`); assert.ok(block.includes(`('${k}','en','${defaults[k]}')`), `${name}: the en row differs from the defaults`); }
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/); assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
});
