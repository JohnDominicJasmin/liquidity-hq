/* QA: PR #2759 (QA's failing-text-2731 C2 finding): no LONE LIVE CANDLE on a failed first load.
 *
 * THE WRITTEN RULE (PM 2026-11-20 + Dev's PR): the chart's two live websocket handlers (Bybit and Binance) used to call `callback(bar)` on every frame with no regard for the history, so when every kline request failed the chart still drew ONE live candle on an empty chart (C2: "the chart holds candles although every kline request failed", expected 0, received 1). Now a live frame is dropped when the history of THIS load has not been
 * delivered yet, or when it failed and the chart holds no candle; a chart that kept its last good candles (a failed REFRESH) keeps taking live frames; a good load clears the failure. The failure flag is mirrored in a ref (markHistoryFailed) so the handlers can read it.
 *   G1 the real gate (liveFrameAllowed + markHistoryFailed cut from the component, run with stand-in refs): history not delivered -> dropped; delivered and healthy -> taken; failed AND empty -> dropped (the C2 case); failed but candles kept -> taken; a later good load clears it -> taken; a stale generation never allows a frame
 *   G2 markHistoryFailed sets the ref AND calls setHistoryFailed with the same value; no other call site writes the flag directly (every failure / reset goes through it)
 *   G3 both live handlers (Bybit and Binance) ask the gate BEFORE they touch lastCloseRef / the EMA bar / callback(bar), and there are exactly two gates
 *   G4 the three failure sites raise it with `markHistoryFailed(true)` and the reset with `markHistoryFailed(false)`
 * WHAT THIS CANNOT PROVE: a real frame arriving on a real socket in the browser (that is failing-text-2731 C2 on a deployed build, which already expects 0 candles). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const count = (s: string, needle: string) => s.split(needle).length - 1;

const markAt = src.indexOf('const markHistoryFailed = (v: boolean) => {'); assert.ok(markAt > 0, 'CONTROL: markHistoryFailed was not found: the matcher lost its target');
const markLine = src.slice(markAt, src.indexOf('\n', markAt));
const gateAt = src.indexOf('const liveFrameAllowed = (): boolean =>'); assert.ok(gateAt > 0, 'CONTROL: liveFrameAllowed was not found');
const gateText = src.slice(gateAt, src.indexOf(';\n', gateAt) + 1);

type Refs = { delivered: number; load: number; failedRef: { current: boolean }; len: number };
function world(r: Partial<Refs> = {}) {
  const s = { delivered: 0, load: 0, failedRef: { current: false }, len: 0, setCalls: [] as boolean[], ...r };
  const code = stripTypeScriptTypes(`function __cut(historyFailedRef, deliveredGenRef, loadGenRef, chartRef, setHistoryFailed) {\n${markLine}\n${gateText}\nreturn { markHistoryFailed, liveFrameAllowed };\n}`);
  const fns = new Function(`${code}\nreturn __cut;`)()(s.failedRef, { get current() { return s.delivered; } }, { get current() { return s.load; } }, { get current() { return { getDataList: () => new Array(s.len).fill(0) }; } }, (v: boolean) => s.setCalls.push(v)) as { markHistoryFailed: (v: boolean) => void; liveFrameAllowed: () => boolean };
  return { s, ...fns };
}

test('G1. the gate: dropped until this load\'s history is delivered, dropped on a failed empty chart, taken when healthy or when last-good candles were kept', () => {
  const a = world({ delivered: 3, load: 4 }); assert.equal(a.liveFrameAllowed(), false, 'a live frame was taken before this load\'s history was delivered');
  const b = world({ delivered: 4, load: 4, len: 300 }); assert.equal(b.liveFrameAllowed(), true, 'a healthy loaded chart must take live frames');
  const c = world({ delivered: 4, load: 4, len: 0 }); c.markHistoryFailed(true); assert.equal(c.liveFrameAllowed(), false, 'C2: a failed first load with no candles took a live frame');
  const d = world({ delivered: 4, load: 4, len: 300 }); d.markHistoryFailed(true); assert.equal(d.liveFrameAllowed(), true, 'a failed REFRESH that kept the last good candles must keep taking live frames');
  const e = world({ delivered: 4, load: 4, len: 0 }); e.markHistoryFailed(true); assert.equal(e.liveFrameAllowed(), false); e.markHistoryFailed(false); assert.equal(e.liveFrameAllowed(), true, 'a later good load must clear the failure');
  const f = world({ delivered: 2, load: 5, len: 300 }); f.markHistoryFailed(true); assert.equal(f.liveFrameAllowed(), false, 'a stale generation allowed a frame');
  const g = world({ delivered: 4, load: 4, len: 0 }); assert.equal(g.liveFrameAllowed(), true, 'delivered, not failed, zero candles (a genuinely empty history) is not the failure case');
});

test('G2. markHistoryFailed mirrors the flag into the ref and the state; nothing else writes the state directly', () => {
  const w = world(); w.markHistoryFailed(true); w.markHistoryFailed(false); w.markHistoryFailed(true);
  assert.deepEqual(w.s.setCalls, [true, false, true], 'the state setter did not get the same values'); assert.equal(w.s.failedRef.current, true, 'the ref does not mirror the flag');
  assert.equal(count(src, 'setHistoryFailed('), 1, 'setHistoryFailed( is called outside markHistoryFailed (the wrapper is the only caller; the useState declaration has no call): a direct write skips the ref and a lone live candle comes back');
});

test('G3. both live handlers ask the gate before they touch lastCloseRef / the EMA bar / callback(bar)', () => {
  assert.equal(count(src, 'if (!liveFrameAllowed()) return;'), 2, 'expected exactly two gates (Bybit and Binance handlers)');
  for (const [name, marker] of [['Bybit', "if (!msg.topic?.startsWith('kline.')"], ['Binance', 'const { k } = JSON.parse(e.data as string)']] as const) {
    const at = src.indexOf(marker); assert.ok(at > 0, `${name}: handler not found`); const block = src.slice(at, at + 1400);
    const g = block.indexOf('if (!liveFrameAllowed()) return;'), c = block.indexOf('callback(bar);'), l = block.indexOf('lastCloseRef.current = bar.close;'), u = block.indexOf('upsertEmaBar(bar);');
    assert.ok(g > 0 && c > 0 && l > 0 && u > 0, `${name}: gate / callback / lastClose / ema not all found in the handler`);
    assert.ok(g < l && g < u && g < c, `${name}: the gate comes after the live bar is used (a dropped frame must not move lastClose or the EMA either)`);
  }
});

test('G4. the failure sites raise it through markHistoryFailed(true) and the reset clears it through markHistoryFailed(false)', () => {
  assert.equal(count(src, 'markHistoryFailed(true)'), 3, 'expected exactly three failure sites (Bybit-only empty path, the all-sources-empty path, the catch)');
  assert.equal(count(src, 'markHistoryFailed(false)'), 1, 'expected one reset (a new load clears the previous failure)');
  assert.match(src, /const historyFailedRef = useRef\(false\);/, 'the ref the gate reads is not declared');
});
