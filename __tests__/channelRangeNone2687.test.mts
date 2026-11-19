import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { channelCandles } from '../qa/fixtures/channelCandles.ts';
import { detectChannel, MIN_CANDLES as CH_MIN } from '../lib/strategies/channel.ts';
import { detectRangeBounce, MIN_CANDLES as RB_MIN } from '../lib/strategies/rangeBounce.ts';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { strategyUnavailable } from '../lib/strategies/availability.ts';

/* #2687 (QA drawings audit #1263, 2026-11-20: channel and range_bounce showed "No close outside a channel yet." / "No bounce from a range edge." with nothing drawn; ny_open_breakout and session_sweep were selectable at 1m but could draw nothing). Written rule (PR body): when no channel / no range is found the call box SAYS SO ("No channel found on the last candles." / "No range found: price is not moving inside a narrow band.") instead of a bare WAIT; a channel that exists is still drawn on WAIT and a range that exists still draws its edges; fewer than the minimum candles stays a plain WAIT; NY open breakout and session sweep are greyed at 1m with "Works on 5m or higher." (the oracle qa/fixtures/strategyAvailability.ts and strategyAvailability2604 carry that rule).
 *   N1 channel: none vs drawn vs too-few-candles   N2 range bounce: none vs drawn vs too-few-candles   N3 the reason key only for the none case, on the real strategy definitions   N4 the 1m greying and its neighbours   N5 the labels: registered, English in the defaults, the held migration equal for PROD/DEV in en/ko/zh/ru/ar
 * NOT covered (browser cells after deploy): what the panel draws on the chart for a drawn channel. */
const ctx = { coin: 'BTC', tf: '4h', tfMs: 4 * 3_600_000 } as never;
const ohlcv = (cs: ReturnType<typeof channelCandles>['candles']) => cs.map((c) => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
const ramp = (n: number) => Array.from({ length: n }, (_, i) => ({ time: 1_760_000_000_000 + i * 14_400_000, open: 100 + i, high: 100.5 + i, low: 99.5 + i, close: 100.4 + i, volume: 1 }));
const CHANNEL = STRATEGIES.find((s) => s.id === 'channel')!, RANGE = STRATEGIES.find((s) => s.id === 'range_bounce')!;
const slopeFx = (dir: 'rising' | 'falling', slopePct: number) => ohlcv(channelCandles({ dir, slopePct, breakout: 'none' }).candles);

test('N1. channel: a straight ramp has no channel and SAYS so; a real channel is drawn on WAIT (no "none"); too few candles is a plain WAIT', () => {
  const none = detectChannel(ramp(90), ctx); assert.equal(none.verdict, 'wait'); assert.equal(none.params.none, true, 'no channel must be marked none'); assert.equal(none.overlay, undefined, 'nothing is drawn when there is no channel');
  for (const dir of ['rising', 'falling'] as const) {
    const r = detectChannel(slopeFx(dir, 0.01), ctx); assert.equal(r.verdict, 'wait'); assert.equal(r.params.none, undefined, `${dir}: a channel that exists is not "none"`);
    assert.equal(r.overlay?.lines?.length, 2, `${dir}: the two rails are drawn`); assert.ok(r.overlay!.lines!.every((l) => l.role === 'watch'), `${dir}: the WAIT rails are watched, not a signal`); assert.deepEqual(r.overlay!.levels, []);
  }
  const flatFx = detectChannel(slopeFx('rising', 0), ctx); assert.equal(flatFx.params.none, true, 'a perfectly flat band is a range, not a channel: the channel strategy says it found none');
  const short = detectChannel(ramp(CH_MIN - 1), ctx); assert.equal(short.verdict, 'wait'); assert.equal(short.params.none, undefined, 'too few candles is not "no channel found"'); assert.equal(short.overlay, undefined);
});
test('N2. range bounce: a straight ramp has no range and SAYS so; a real range keeps its edges (no "none"); too few candles is a plain WAIT', () => {
  const none = detectRangeBounce(ramp(90), ctx); assert.equal(none.verdict, 'wait'); assert.equal(none.params.none, true); assert.equal(none.overlay, undefined);
  const r = detectRangeBounce(slopeFx('rising', 0), ctx); assert.equal(r.params.none, undefined, 'a band that exists is not "none"'); assert.ok(typeof r.params.low === 'number' && typeof r.params.high === 'number', 'the range edges are carried by the call');
  const short = detectRangeBounce(ramp(RB_MIN - 1), ctx); assert.equal(short.params.none, undefined); assert.equal(short.overlay, undefined);
});
test('N3. the reason key is set only for the none case, on the real definitions', () => {
  assert.equal(CHANNEL.reasonKeyFor!(detectChannel(ramp(90), ctx) as never), 'STRAT_CHANNEL_WAIT_NONE'); assert.equal(RANGE.reasonKeyFor!(detectRangeBounce(ramp(90), ctx) as never), 'STRAT_RANGE_WAIT_NONE');
  assert.equal(CHANNEL.reasonKeyFor!(detectChannel(slopeFx('rising', 0.01), ctx) as never), null, 'a drawn channel has no reason line'); assert.equal(CHANNEL.reasonKeyFor!(detectChannel(ramp(CH_MIN - 1), ctx) as never), null);
  assert.equal(RANGE.reasonKeyFor!(detectRangeBounce(ramp(RB_MIN - 1), ctx) as never), null);
});
test('N4. NY open breakout and session sweep are greyed at 1m ("5m or higher"); their other limits and the other strategies are untouched', () => {
  const min = { reasonKey: 'STRAT_NA_TF_MIN', vars: { tf: '5m' } }; const u = (id: string, ms: number) => strategyUnavailable(id, 'btc', ms);
  for (const id of ['ny_open_breakout', 'session_sweep']) { assert.deepEqual(u(id, 60_000), min, `${id} at 1m`); assert.equal(u(id, 300_000), null, `${id} at 5m is available`); assert.equal(u(id, 900_000), null, `${id} at 15m is available`); }
  assert.deepEqual(u('ny_open_breakout', 3_600_000), { reasonKey: 'STRAT_NA_TF_MAX', vars: { tf: '30m' } }); assert.deepEqual(u('session_sweep', 7_200_000), { reasonKey: 'STRAT_NA_TF_MAX', vars: { tf: '1h' } }); assert.equal(u('vwap_reclaim', 60_000), null, 'VWAP reclaim is still available at 1m');
  for (const id of ['channel', 'range_bounce', 'ema_stack', 'liq_sweep_mss']) assert.equal(u(id, 60_000), null, `${id} is available at 1m`);
});
test('N5. the labels: registered, English in the defaults, and the held migration carries the same text for PROD and DEV in five locales', () => {
  const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>; const keys = readFileSync(new URL('../lib/labelKeys.ts', import.meta.url), 'utf8'); const sql = readFileSync(new URL('../supabase/migrations/20261126b_labels_channel_range_none.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(defaults.STRAT_CHANNEL_WAIT_NONE, 'No channel found on the last candles.'); assert.equal(defaults.STRAT_RANGE_WAIT_NONE, 'No range found: price is not moving inside a narrow band.'); assert.equal(defaults.STRAT_NA_TF_MIN, 'Works on {tf} or higher.');
  const prod = sql.slice(sql.indexOf('===== PROD ====='), sql.indexOf('===== DEV =====')), dev = sql.slice(sql.indexOf('===== DEV ====='));
  for (const k of ['STRAT_CHANNEL_WAIT_NONE', 'STRAT_RANGE_WAIT_NONE']) {
    assert.ok(keys.includes(`'${k}'`), `${k} not registered`);
    for (const [name, block, table] of [['PROD', prod, 'lhq_labels'], ['DEV', dev, 'lhq_dev_labels']] as const) { assert.ok(block.includes(`insert into ${table} (key, locale, value) values`), `${name}: wrong table`); for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) assert.ok(new RegExp(`\\('${k}','${loc}','[^']+'\\)`).test(block), `${name}: ${k} has no ${loc} row`); assert.ok(block.includes(`('${k}','en','${defaults[k]}')`), `${name}: the en row differs from the defaults`); }
  }
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/); assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
});
