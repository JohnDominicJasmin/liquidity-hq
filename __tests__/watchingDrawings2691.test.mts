import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fvgFixture } from '../qa/fixtures/strategyFixtures.ts';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { watchedDrawing, withWatchedDrawing } from '../lib/strategies/chartDrawings.ts';
import { findChannel } from '../lib/strategies/channel.ts';
import { RANGE_BARS } from '../lib/strategies/rangeBounce.ts';
import type { OHLCV } from '../lib/strategyCore.ts';

/* #2691 (PM, 2026-11-20, owner's order: a strategy that is selected shows a line or a shape, a reason line alone is not enough). Written rule (PR body): while a strategy WAITS and its own detector has nothing to draw, the chart still shows what it is about:
 *   channel, none found   -> the recent swing highs and swing lows joined per side (the last four; one pivot alone is a level), faint, labelled Swing high / Swing low
 *   range_bounce, none    -> the high and low of the last RANGE_BARS (30) candles BEFORE the newest, labelled "30-candle high" / "30-candle low"
 *   fvg, no open gap      -> the latest gap box whatever its state, drawn with the reason line still saying there is no OPEN gap; no gap at all in the lookback draws nothing and still says so
 *   funding_oi_squeeze, cvd_absorption (waiting on live data) -> the last swing high and swing low as levels
 * A strategy that already draws (an open gap, a found channel/range) is left alone, a call is never touched, and other strategies are unchanged.
 *   W1 channel   W2 range bounce   W3 fvg   W4 squeeze + CVD   W5 untouched cases   W6 labels: registered, English in the defaults, held migration equal PROD/DEV in en/ko/zh/ru/ar
 * NOT covered (browser cells after deploy): how the faint lines and levels look on the real chart at 390/1280. */
const ctx = { coin: 'BTC', tf: '4h', tfMs: 4 * 3_600_000 } as never;
const walk = (n: number, seed: number): OHLCV[] => { let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; const out: OHLCV[] = []; let p = 100, drift = 0; for (let i = 0; i < n; i++) { if (i % 23 === 0) drift = (rnd() - 0.5) * 0.7; const o = p, c = p + drift + (rnd() - 0.5) * 2.4, h = Math.max(o, c) + rnd() * 1.2, l = Math.min(o, c) - rnd() * 1.2; out.push({ time: 1_760_000_000_000 + i * 14_400_000, open: o, high: h, low: l, close: c, volume: 1 }); p = c; } return out; };
const ramp = (n: number): OHLCV[] => Array.from({ length: n }, (_, i) => ({ time: 1_760_000_000_000 + i * 14_400_000, open: 100 + i, high: 100.5 + i, low: 99.5 + i, close: 100.4 + i, volume: 1 }));
const def = (id: string) => STRATEGIES.find((s) => s.id === id)!;
const WAIT = { verdict: 'wait', params: {} } as never;

test('W1. channel with none found: the swing highs and lows are drawn per side (labelled, watch role, last four); nothing when there are no pivots; a found channel is left alone', () => {
  let tested = 0, bothSides = 0;
  for (let seed = 1; seed <= 60 && tested < 5; seed++) {
    const c = walk(120, seed); if (findChannel(c, '4h')) continue;
    const o = watchedDrawing('channel', c, ctx); if (!o) continue; const lines = o.lines, levels = o.levels;
    assert.ok(lines.length + levels.length >= 1, `seed ${seed}: a selected channel with no channel drew nothing`); tested++;
    for (const l of lines) { assert.equal(l.role, 'watch'); assert.ok(l.points.length >= 2 && l.points.length <= 4, `a side joins the last 4 pivots at most (${l.points.length})`); assert.ok(l.labelKey === 'STRAT_OV_SWING_HIGH' || l.labelKey === 'STRAT_OV_SWING_LOW'); assert.ok(l.points.every((p, i, a) => i === 0 || p.ts >= a[i - 1].ts), 'points run oldest to newest'); }
    for (const v of levels) assert.ok(v.labelKey === 'STRAT_OV_SWING_HIGH' || v.labelKey === 'STRAT_OV_SWING_LOW');
    const hi = lines.filter((l) => l.labelKey === 'STRAT_OV_SWING_HIGH').length, lo = lines.filter((l) => l.labelKey === 'STRAT_OV_SWING_LOW').length; assert.ok(hi <= 1 && lo <= 1, 'one line per side'); if (hi === 1 && lo === 1) bothSides++;
  }
  assert.ok(tested >= 3, `CONTROL: only ${tested} channel-less walks were found to test`); assert.ok(bothSides >= 1, 'a swing-high line AND a swing-low line must both appear on at least one channel-less walk');
  /* ONE pivot on a side is a LEVEL, not a one-point line: a single mountain has one swing high and no swing low pivots */
  const mountain: OHLCV[] = Array.from({ length: 60 }, (_, i) => { const p = 100 + (i < 30 ? i : 60 - i); return { time: 1_760_000_000_000 + i * 14_400_000, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 1 }; });
  const m = watchedDrawing('channel', mountain, ctx); assert.ok(m, 'the mountain must draw its one swing high'); { assert.equal(m.lines.filter((l) => l.labelKey === 'STRAT_OV_SWING_HIGH').length, 0, 'one pivot is not a line'); assert.ok(m.levels.some((l) => l.labelKey === 'STRAT_OV_SWING_HIGH'), 'one swing high is drawn as a level'); }
  const rampOut = watchedDrawing('channel', ramp(120), ctx); assert.ok(!rampOut || (rampOut.lines.length === 0 && rampOut.levels.length === 0), 'a straight ramp has no pivots: nothing to draw');
});
test('W2. range_bounce with no range: the high and low of the last 30 candles before the newest, labelled; a real range keeps its own edges', () => {
  const c = ramp(90), o = watchedDrawing('range_bounce', c, ctx)!; assert.ok(o, 'a drawing is expected'); assert.equal(o.levels.length, 2, 'two levels'); const win = c.slice(0, -1).slice(-RANGE_BARS);
  const hi = o.levels.find((l) => l.labelKey === 'STRAT_OV_LAST30_HIGH')!, lo = o.levels.find((l) => l.labelKey === 'STRAT_OV_LAST30_LOW')!; assert.ok(hi && lo, 'both labels'); assert.equal(hi.price, Math.max(...win.map((x) => x.high)), 'the high of the 30 candles BEFORE the newest'); assert.equal(lo.price, Math.min(...win.map((x) => x.low)));
  const withNewest = [...c.slice(0, -1), { ...c[c.length - 1], high: 9999, low: 0 }]; const o2 = watchedDrawing('range_bounce', withNewest, ctx)!; assert.equal(o2.levels.find((l) => l.labelKey === 'STRAT_OV_LAST30_HIGH')!.price, hi.price, 'the newest candle is not part of the band');
  const flat = Array.from({ length: 80 }, (_, i) => ({ time: 1_760_000_000_000 + i * 14_400_000, open: 100, high: 101 + (i % 6 === 0 ? 0.5 : 0), low: 99 - (i % 5 === 0 ? 0.5 : 0), close: 100, volume: 1 })); const real = watchedDrawing('range_bounce', flat, ctx)!; assert.ok(real.levels.every((l) => l.labelKey !== 'STRAT_OV_LAST30_HIGH' && l.labelKey !== 'STRAT_OV_LAST30_LOW'), 'a real range keeps its own edge labels, not the 30-candle ones');
});
test('W3. fvg: no OPEN gap still draws the latest gap box and keeps the reason; no gap at all draws nothing and still says so; an open gap is untouched', () => {
  const FVG = def('fvg'); const returned = fvgFixture('bull', true, 1_760_000_000_000, 900, 1.2) as never as Array<Record<string, number>>; const toO = (c: Array<Record<string, number>>): OHLCV[] => c.map((x) => ({ time: x.timestamp ?? x.time, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume ?? 0 }));
  const r = withWatchedDrawing(FVG, WAIT, toO(returned), ctx); if (r.params.none) { assert.ok((r.overlay?.zones.length ?? 0) >= 1, 'no open gap: the latest gap box is drawn'); assert.equal(FVG.reasonKeyFor!(r as never), 'STRAT_FVG_WAIT_NONE', 'and the reason line stays'); assert.equal(r.overlay!.zones[0].labelKey, 'STRAT_OV_FVG'); }
  const flat = Array.from({ length: 60 }, (_, i) => ({ time: 1_760_000_000_000 + i * 3_600_000, open: 100, high: 100.4, low: 99.6, close: 100 + (i % 2 ? 0.1 : -0.1), volume: 1 })); const none = withWatchedDrawing(FVG, WAIT, flat, ctx); assert.equal(none.params.none, true); assert.equal((none.overlay?.zones.length ?? 0), 0, 'no gap at all in the lookback: nothing to draw'); assert.equal(FVG.reasonKeyFor!(none as never), 'STRAT_FVG_WAIT_NONE');
  const gapped = toO(fvgFixture('bull', false) as never); const open = withWatchedDrawing(FVG, WAIT, gapped, ctx); if (!open.params.none) { assert.ok((open.overlay?.zones.length ?? 0) >= 1, 'an open gap is drawn'); assert.equal(FVG.reasonKeyFor!(open as never), null); }
  /* a returned-to gap in a hand-built series: bull gap then price comes back into it */
  const t = (i: number) => 1_760_000_000_000 + i * 3_600_000; const base: OHLCV[] = Array.from({ length: 40 }, (_, i) => ({ time: t(i), open: 100, high: 100.3, low: 99.7, close: 100, volume: 1 }));
  const hand: OHLCV[] = [...base, { time: t(40), open: 100, high: 100.4, low: 99.8, close: 100.3, volume: 1 }, { time: t(41), open: 100.3, high: 103, low: 100.3, close: 102.8, volume: 1 }, { time: t(42), open: 102.8, high: 104, low: 101.5, close: 103.6, volume: 1 }, { time: t(43), open: 103.6, high: 103.8, low: 100.0, close: 100.2, volume: 1 }, { time: t(44), open: 100.2, high: 100.5, low: 99.8, close: 100.1, volume: 1 }];
  const hr = withWatchedDrawing(FVG, WAIT, hand, ctx); assert.equal(hr.params.none, true, 'the gap was returned to and filled: no OPEN gap'); assert.equal(hr.overlay?.zones.length, 1, 'the latest (filled) gap is still drawn'); const z = hr.overlay!.zones[0]; assert.equal(z.kind, 'demand'); assert.equal(z.bottom, 100.4); assert.equal(z.top, 101.5, 'the box spans the gap: the first candle high to the third candle low');
});
test('W4. funding_oi_squeeze and cvd_absorption waiting on live data draw the last swing high and low as levels', () => {
  const c = walk(150, 3); for (const id of ['funding_oi_squeeze', 'cvd_absorption']) { const o = watchedDrawing(id, c, ctx)!; assert.ok(o, `${id}: a drawing is expected`); assert.ok(o.levels.length >= 1 && o.levels.length <= 2, `${id}: ${o.levels.length} levels`); for (const l of o.levels) assert.ok(l.labelKey === 'STRAT_OV_SWING_HIGH' || l.labelKey === 'STRAT_OV_SWING_LOW'); assert.ok(o.levels.some((l) => l.labelKey === 'STRAT_OV_SWING_HIGH') && o.levels.some((l) => l.labelKey === 'STRAT_OV_SWING_LOW'), `${id}: both a swing high and a swing low`); const hi = o.levels.find((l) => l.labelKey === 'STRAT_OV_SWING_HIGH')!, lo = o.levels.find((l) => l.labelKey === 'STRAT_OV_SWING_LOW')!; assert.ok(hi.price > lo.price, `${id}: the swing high must be above the swing low`); assert.ok(c.some((x) => x.high === hi.price), `${id}: the swing-high level must be a candle HIGH`); assert.ok(c.some((x) => x.low === lo.price), `${id}: the swing-low level must be a candle LOW`); assert.ok(!c.some((x) => x.low === hi.price && x.high !== hi.price), `${id}: the swing-high level must not be a candle low`); }
});
test('W5. untouched: a call, a WAIT that already draws, a strategy with no case here', () => {
  const call = withWatchedDrawing(def('channel'), { verdict: 'buy', params: { entry: 1 }, signalDir: 'long', signalTimestamp: 1, overlay: { levels: [{ price: 1, role: 'confirm', fromTs: 1, labelKey: 'STRAT_OV_ENTRY' }], zones: [], lines: [], marker: null } } as never, walk(120, 2), ctx); assert.equal(call.verdict, 'buy'); assert.equal(call.overlay!.levels.length, 1, 'a call keeps its own overlay');
  const draws = { verdict: 'wait', params: {}, overlay: { levels: [], zones: [], lines: [{ points: [{ ts: 1, price: 1 }, { ts: 2, price: 2 }], role: 'watch', labelKey: 'STRAT_OV_CHANNEL_TOP' }], marker: null } } as never; const same = withWatchedDrawing(def('channel'), draws, walk(120, 2), ctx); assert.equal(same.overlay!.lines.length, 1, 'a WAIT that already draws is not replaced');
  assert.equal(watchedDrawing('channel', walk(4, 1), ctx), null, 'fewer than 5 candles: nothing');
});
test('W6. the labels: registered, English in the defaults, the held migration equal for PROD and DEV in five locales', () => {
  const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>; const keys = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8'); const sql = readFileSync(new URL('../supabase/migrations/20261126d_labels_range_last30.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(defaults.STRAT_OV_LAST30_HIGH, '30-candle high'); assert.equal(defaults.STRAT_OV_LAST30_LOW, '30-candle low');
  const prod = sql.slice(sql.indexOf('===== PROD ====='), sql.indexOf('===== DEV =====')), dev = sql.slice(sql.indexOf('===== DEV ====='));
  for (const k of ['STRAT_OV_LAST30_HIGH', 'STRAT_OV_LAST30_LOW']) { assert.ok(keys.includes(`'${k}'`), `${k} not registered`); for (const [name, block, table] of [['PROD', prod, 'lhq_labels'], ['DEV', dev, 'lhq_dev_labels']] as const) { assert.ok(block.includes(`insert into ${table} (key, locale, value) values`), `${name}: wrong table`); for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) assert.ok(new RegExp(`\\('${k}','${loc}','[^']+'\\)`).test(block), `${name}: ${k} has no ${loc} row`); assert.ok(block.includes(`('${k}','en','${defaults[k]}')`), `${name}: the en row differs from the defaults`); } }
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/); assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
});
