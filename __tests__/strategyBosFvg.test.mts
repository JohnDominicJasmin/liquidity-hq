import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { detectBosFvg, BOS_FVG, MIN_CANDLES, RETURN_WINDOW } from '../lib/strategies/bosFvg.ts';
import { STRATEGIES, STRATEGY_GROUPS, STRATEGY_IDS, STRATEGY_TIP_KEYS, findStrategy } from '../lib/strategies/index.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { isStrategyRuleKey } from '../lib/alertOutcomes.ts';
import type { OHLCV } from '../lib/strategyCore.ts';
import type { StrategyResult } from '../lib/strategies/types.ts';

/* QA's unit cells for the "Break of structure + FVG" strategy (id bos_fvg, PR #2566, migration 20261119o). Owner: QA (CONTRIBUTING.md: dev writes no tests).
 * EVERY EXPECTATION BELOW COMES FROM THE WRITTEN RULE in the header comment of lib/strategies/bosFvg.ts (and fairValueGap.ts for the gap and the target), never from running the detector and copying its answer. The rule, as quoted per cell:
 *   "BUY: a candle CLOSES above the latest confirmed swing high, the first close above it since that swing formed. The leg from the latest confirmed swing low to that candle holds a bullish 3-candle gap
 *    (candle i-2's high below candle i's low; the gap is [i-2 high, i low]). The signal is the FIRST candle after the break whose low is at or below the gap's top, the gap still unfilled (no close below its bottom
 *    since it formed), closing above the gap's bottom, and that candle is the last closed candle. No return within RETURN_WINDOW candles of the break: wait.
 *  SELL: the mirror."  Entry = the signal candle's close. Stop = the gap's far edge. Target = the nearer of the 20-candle swing before the gap and the first S/R level at least one risk distance away.
 * THE MARKET (hand-built, every number chosen so the rule's answer is stated before the detector runs; index: high / low / close):
 *   0-9   flat 101 / 99 / 100 (equal highs and lows: no swing, strictness is "strictly beyond")
 *   10    100 / 95 / 97    the confirmed SWING LOW (lows 99, 98, 99, 100 around it are all above 95)
 *   11-13 101..103 / 98..100 / 100..102 rising
 *   14    110 / 101 / 104  the confirmed SWING HIGH 110 (highs around it are at most 104)
 *   15-18 104 / ~101-102 / 103 a quiet pullback (no later swing)
 *   19    109 / 103 / 108  a big up candle that does NOT close above 110
 *   20    114 / 107 / 112  the BREAK: closes above 110 for the first time; its low 107 is above candle 18's high 104, so the BULLISH GAP is [104, 107]
 *   21..  the pullback fillers: high 111, low just above 107 (107.5, 107.51 ...), close 109.5 (never above 110, never below 104): the gap is not touched and not filled
 *   last  the RETURN candle: low 106 (at or below the gap top 107), close 109 (above the gap bottom 104)
 * So by the rule: BUY, entry 109, stop 104; the swing high 110 is only 1 above the entry (under 1R = 5), so (#2603: a target is never nearer than 1R) the target is the first S/R level at least 1R away: the break candle high 114, R:R 1.0, params bos 110 / gapLo 104 / gapHi 107.
 * WHAT IT CANNOT PROVE: what the chart draws, the label text in a browser, the real market. Browser cells are listed in the QA report on #2566. */

const T0 = 1_700_000_000_000, TF = 900_000;
const CTX = { coin: 'btc', tf: '15m', tfMs: TF };
type Row = [number, number, number];   // high, low, close

interface Opts { breakClose?: number; breakLow?: number; fill?: number; retLow?: number; retClose?: number; noReturn?: boolean; mod?: (rows: Row[]) => void }
/** The bullish market above. `fill` = filler candles between the break (index 20) and the return candle; the return is at index 21 + fill. */
function bullRows(o: Opts = {}): Row[] {
  const { breakClose = 112, breakLow = 107, fill = 8, retLow = 106, retClose = 109 } = o;
  const rows: Row[] = [];
  for (let i = 0; i < 10; i++) rows.push([101, 99, 100]);
  rows.push([100, 95, 97], [101, 98, 100], [102, 99, 101], [103, 100, 102], [110, 101, 104], [104, 101, 103], [104, 101.5, 103], [104, 102, 103], [104, 102, 103], [109, 103, 108]);
  rows.push([114, breakLow, breakClose]);
  for (let j = 0; j < fill; j++) rows.push([111, 107.5 + 0.01 * j, 109.5]);
  if (!o.noReturn) rows.push([111, retLow, retClose]);
  o.mod?.(rows);
  return rows;
}
const toCandles = (rows: Row[]): OHLCV[] => rows.map(([high, low, close], i) => ({ time: T0 + i * TF, open: i === 0 ? close : rows[i - 1][2], high, low, close, volume: 100 }));
/** The mirror image about 200: every high becomes 200-low, every low 200-high, every close 200-close. The rule says SELL is "the mirror", so the mirrored market must give the mirrored answer. */
const mirror = (rows: Row[]): Row[] => rows.map(([h, l, c]) => [200 - l, 200 - h, 200 - c]);
const bull = (o?: Opts): StrategyResult => detectBosFvg(toCandles(bullRows(o)), CTX);
const bear = (o?: Opts): StrategyResult => detectBosFvg(toCandles(mirror(bullRows(o))), CTX);
const finite = (v: unknown): boolean => v == null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : typeof v === 'object' ? Object.values(v as object).every(finite) : true);

/* ---------------- (a) the clean bullish break + gap, and (b) its mirror ---------------- */

test('a. BUY: a first close above the confirmed swing high leaves a bullish gap, and the first return into it (the last candle) closes above the gap bottom', () => {
  const cs = toCandles(bullRows()); assert.equal(cs.length, 30);
  const r = detectBosFvg(cs, CTX);
  assert.equal(r.verdict, 'buy'); assert.equal(r.signalDir, 'long'); assert.equal(r.signalTimestamp, cs[29].time, 'the signal candle is the return candle (the last closed one)');
  const p = r.params;
  assert.equal(p.bos, 110, 'the broken swing high'); assert.equal(p.gapLo, 104, 'gap bottom = candle i-2 high'); assert.equal(p.gapHi, 107, 'gap top = candle i low');
  assert.equal(p.entry, 109, 'entry = the signal candle close'); assert.equal(p.stop, 104, 'stop = the gap bottom (far edge)'); assert.equal(p.inv, 104);
  assert.equal(p.target, 114, '#2603 rule: the target is NEVER nearer than 1R (the swing high 110 is only 1 away, under the 5 of risk): the first S/R level at least 1R away is the break candle high 114 (entry 109 + risk 5)'); assert.equal(p.rr, 1, '(114-109)/(109-104)');
  const o = r.overlay!; assert.deepEqual(o.marker, { ts: cs[29].time, dir: 'long' });
  assert.deepEqual(o.zones, [{ top: 107, bottom: 104, fromTs: cs[20].time, toTs: cs[29].time, kind: 'demand', labelKey: 'STRAT_OV_FVG' }]);
  assert.ok(o.levels.some((l) => l.price === 110 && l.role === 'ref' && l.labelKey === 'STRAT_OV_BOS' && l.fromTs === cs[14].time), 'the break level is drawn from the swing high candle');
  assert.ok(o.levels.some((l) => l.price === 104 && l.role === 'invalid' && l.labelKey === 'STRAT_OV_STOP'));
  assert.ok(finite(r), 'a non-finite number in the result');
});

test('b. SELL: the mirror market (close below the swing low, a bearish gap, the first return up into it) gives the mirrored call', () => {
  const cs = toCandles(mirror(bullRows())); const r = detectBosFvg(cs, CTX);
  assert.equal(r.verdict, 'sell'); assert.equal(r.signalDir, 'short'); assert.equal(r.signalTimestamp, cs[29].time);
  const p = r.params;
  assert.equal(p.bos, 90, 'the broken swing low = 200-110'); assert.equal(p.gapLo, 93, 'bearish gap = [i high, i-2 low] = [200-107, 200-104]'); assert.equal(p.gapHi, 96);
  assert.equal(p.entry, 91); assert.equal(p.stop, 96, 'stop = the gap top (far edge)'); assert.equal(p.target, 86, '#2603 rule, the mirror: the swing low 90 is only 1 away, under the 5 of risk: the first S/R level at least 1R away is 200-114 = 86'); assert.equal(p.rr, 1);
  const o = r.overlay!; assert.deepEqual(o.marker, { ts: cs[29].time, dir: 'short' });
  assert.deepEqual(o.zones, [{ top: 96, bottom: 93, fromTs: cs[20].time, toTs: cs[29].time, kind: 'supply', labelKey: 'STRAT_OV_FVG' }]);
  assert.ok(finite(r));
});

/* ---------------- (c) a break with no gap, (d) a gap with no break ---------------- */

test('c. WAIT: a break of structure with NO gap in the leg (the break candle low 103 is not above candle 18 high 104; no other three candles leave one)', () => {
  for (const [name, r] of [['bull', bull({ breakLow: 103 })], ['mirror', bear({ breakLow: 103 })]] as const) { assert.equal(r.verdict, 'wait', name); assert.equal(r.signalTimestamp, null, name); assert.equal(r.signalDir, null, name); assert.deepEqual(r.params, {}, name); }
});

test('d. WAIT: a gap with NO break (the candle that leaves the gap closes at 109, below the swing high 110, and nothing closes above it afterwards), even with a return into the gap', () => {
  for (const [name, r] of [['bull', bull({ breakClose: 109 })], ['mirror', bear({ breakClose: 109 })]] as const) { assert.equal(r.verdict, 'wait', name); assert.equal(r.signalDir, null, name); assert.equal(r.signalTimestamp, null, name); }
});

/* ---------------- (f) the boundaries the rule states ---------------- */

test('f1. the break is a close ABOVE the swing high: a close exactly at 110 is not a break (wait), 110.01 is (buy)', () => {
  assert.equal(bull({ breakClose: 110 }).verdict, 'wait'); assert.equal(bear({ breakClose: 110 }).verdict, 'wait');
  const r = bull({ breakClose: 110.01 }); assert.equal(r.verdict, 'buy'); assert.equal(r.params.bos, 110);
});

test('f2. the gap is candle i-2 HIGH BELOW candle i LOW: equal (104 and 104) is no gap (wait), a hair above (104.01) is a gap [104, 104.01] (buy when the return reaches it). The rule states NO minimum gap size', () => {
  assert.equal(bull({ breakLow: 104, retLow: 104 }).verdict, 'wait', 'equal edges: no gap'); assert.equal(bear({ breakLow: 104, retLow: 104 }).verdict, 'wait');
  const r = bull({ breakLow: 104.01, retLow: 104 }); assert.equal(r.verdict, 'buy'); assert.equal(r.params.gapLo, 104); assert.equal(r.params.gapHi, 104.01);
  assert.equal(bull({ breakLow: 104.01, retLow: 106 }).verdict, 'wait', 'the same gap without a return into it is a wait');
});

test('f3. a return is a candle whose low is AT OR BELOW the gap top: low 107 (equal) is a return (buy), 107.01 is not (wait)', () => {
  assert.equal(bull({ retLow: 107 }).verdict, 'buy'); assert.equal(bear({ retLow: 107 }).verdict, 'sell');
  assert.equal(bull({ retLow: 107.01 }).verdict, 'wait');
});

test('f4. the return must CLOSE ABOVE the gap bottom: a close exactly at 104 is a wait, 104.01 is a buy (stop 104)', () => {
  assert.equal(bull({ retLow: 103.9, retClose: 104 }).verdict, 'wait'); assert.equal(bear({ retLow: 103.9, retClose: 104 }).verdict, 'wait');
  const r = bull({ retLow: 103.9, retClose: 104.01 }); assert.equal(r.verdict, 'buy'); assert.equal(r.params.stop, 104);
});

test('f5. the signal is the FIRST return only: the same candle is a BUY while it is the last closed candle and a WAIT once a later candle exists (the later candle is not a first return)', () => {
  assert.equal(detectBosFvg(toCandles(bullRows()), CTX).verdict, 'buy', 'the first return as the last candle is a buy');
  const longer = bullRows({ fill: 9, retLow: 106, retClose: 109, mod: (r) => { r.push([111, 106, 109]); } });   // first return at index 30, a second touch at 31
  assert.equal(detectBosFvg(toCandles(longer), CTX).verdict, 'wait', 'the second touch is not the first return');
  assert.equal(detectBosFvg(toCandles(longer).slice(0, 31), CTX).verdict, 'buy', 'the first touch is a buy while it is the last candle');
});

/* f6 (RE-PINNED for the STRICT mitigation rule, PM 2026-11-18, #2566 head 5b920c0b): "a gap that any candle traded into between its formation and the break (break candle included) is MITIGATED and skipped; an earlier or later gap in the same leg can still qualify."
 * The world: gap [104,107] is left by candle 20 (candle 18 high 104, candle 20 low 107, close 109: no break yet); candle 21 is the DIP; candle 22 is the break (first close above 110); the return candle is last. */
const f6world = (dip: Row, brk: Row = [114, 108, 112]): Row[] => { const rows = bullRows(); rows.splice(20, 1, [109, 107, 109], dip, brk); return rows; };
test('f6a. a gap price traded INTO before the break is mitigated: wait (a touch to 105 inside [104,107], and a close below the bottom, both)', () => {
  assert.equal(detectBosFvg(toCandles(f6world([109, 105, 106])), CTX).verdict, 'wait', 'a candle dipped into the gap before the break: the gap is mitigated');
  assert.equal(detectBosFvg(toCandles(f6world([109, 102, 103])), CTX).verdict, 'wait', 'a close below the gap bottom (filled) is mitigated too');
});
test('f6b. the BREAK candle itself touching the gap mitigates it (low 107 equals the gap top: equal counts as a touch); low 108 does not', () => {
  assert.equal(detectBosFvg(toCandles(f6world([109, 108, 109], [114, 107, 112])), CTX).verdict, 'wait', 'the break candle touched the gap top: mitigated');
  assert.equal(detectBosFvg(toCandles(f6world([109, 108, 109], [114, 107.01, 112])), CTX).verdict, 'buy', 'low 107.01 is above the top 107: the gap is untouched');
});
test('f6c. CONTROL: with the dip staying ABOVE the gap (low 108) the same world is a BUY on the gap [104,107]: the waits above are the mitigation and nothing else', () => {
  const r = detectBosFvg(toCandles(f6world([109, 108, 109])), CTX);
  assert.equal(r.verdict, 'buy'); assert.equal(r.params.gapLo, 104); assert.equal(r.params.gapHi, 107); assert.equal(r.params.bos, 110);
});
test('f6d. ANOTHER gap in the same leg can still qualify: the old gap [104,107] is mitigated by the dip, the break candle leaves a NEW gap [109,110.5] (candle 20 high 109 below candle 22 low 110.5) that the return candle enters', () => {
  const rows = bullRows({ fill: 0, retClose: 109.8 }); rows.splice(20, 1, [109, 107, 109], [109, 105, 106], [114, 110.5, 112]); for (let i = 0; i < 8; i++) rows.unshift([101, 99, 100]);   /* 8 flat candles in front: MIN_CANDLES (30) needs them; flat equal highs/lows are no swing */
  const r = detectBosFvg(toCandles(rows), CTX);
  assert.equal(r.verdict, 'buy', 'the new untouched gap must qualify'); assert.equal(r.params.gapLo, 109); assert.equal(r.params.gapHi, 110.5); assert.equal(r.params.bos, 110);
});

test('f7. RETURN_WINDOW: a return 20 candles after the break is within the window (buy), 21 candles after is not (wait)', () => {
  assert.equal(RETURN_WINDOW, 20);
  assert.equal(bull({ fill: 19 }).verdict, 'buy', 'return at break + 20'); assert.equal(bull({ fill: 20 }).verdict, 'wait', 'return at break + 21'); assert.equal(bear({ fill: 19 }).verdict, 'sell'); assert.equal(bear({ fill: 20 }).verdict, 'wait');
});

test('f8. a WAIT while the gap has not been returned to yet (and still can be) WATCHES the break level and the gap; a break too old to be returned to watches nothing', () => {
  const cs = toCandles(bullRows({ fill: 9, noReturn: true })); assert.equal(cs.length, 30);
  const r = detectBosFvg(cs, CTX); assert.equal(r.verdict, 'wait'); assert.equal(r.signalTimestamp, null); assert.equal(r.overlay!.marker, null);
  assert.deepEqual(r.overlay!.zones, [{ top: 107, bottom: 104, fromTs: cs[20].time, toTs: cs[29].time, kind: 'demand', labelKey: 'STRAT_OV_FVG' }]);
  assert.deepEqual(r.overlay!.levels, [{ price: 110, role: 'ref', fromTs: cs[14].time, labelKey: 'STRAT_OV_BOS' }]);
  /* last candle = break + 20: the next candle (break + 21) is outside the window, so there is nothing left to watch (index of the last candle = 20 + fill) */
  const last = detectBosFvg(toCandles(bullRows({ fill: 19, noReturn: true })), CTX); assert.ok(last.overlay && last.overlay.zones.length === 1, 'at break + 19 the next candle (break + 20) can still return, so the gap is watched');
  const old = detectBosFvg(toCandles(bullRows({ fill: 20, noReturn: true })), CTX); assert.equal(old.verdict, 'wait'); assert.equal(old.overlay, undefined);
});

test('f9. the break must be the FIRST close above the swing high since it formed: candle 19 already closed at 111, so candle 20 (112) is a second close above it, not the structure break', () => {
  const r = bull({ mod: (rows) => { rows[19] = [112, 103, 111]; } });
  assert.equal(r.verdict, 'wait'); assert.equal(bear({ mod: (rows) => { rows[19] = [112, 103, 111]; } }).verdict, 'wait', 'the mirror (the edit is applied before mirroring)');
});

test('f10. only a gap INSIDE THE LEG (from the latest confirmed swing low to the break) counts: a gap left on candle 5, before the swing low on candle 10, is not part of the leg, even though price returns to it', () => {
  /* candle 3 high 96 and candle 5 low 99 leave a bullish gap [96, 99] long before the swing low (candle 10); the leg has NO gap (break candle low 103); the last candle returns to 98 (inside the old gap) and closes at 109 */
  const old = (rows: Row[]) => { rows[3] = [96, 94, 95]; };
  assert.equal(bull({ breakLow: 103, retLow: 98, retClose: 109, mod: old }).verdict, 'wait'); assert.equal(bear({ breakLow: 103, retLow: 98, retClose: 109, mod: old }).verdict, 'wait');
});

/* ---------------- (e) too few candles, missing OHLC, NaN: never a throw, never a non-finite number ---------------- */

test('e1. fewer than MIN_CANDLES (30) closed candles is a wait: 29 candles that would otherwise be a buy, and the empty list', () => {
  assert.equal(MIN_CANDLES, 30); assert.equal(BOS_FVG.minCandles, 30);
  const all = toCandles(bullRows()); assert.equal(detectBosFvg(all, CTX).verdict, 'buy');
  assert.equal(detectBosFvg(all.slice(1), CTX).verdict, 'wait', '29 candles: the same market with its first candle dropped is below the minimum');
  assert.equal(detectBosFvg([], CTX).verdict, 'wait'); assert.equal(detectBosFvg(all.slice(0, 5), CTX).verdict, 'wait');
  for (const r of [detectBosFvg([], CTX), detectBosFvg(all.slice(1), CTX)]) { assert.equal(r.signalTimestamp, null); assert.equal(r.signalDir, null); assert.deepEqual(r.params, {}); }
});

test('e2. a NaN or an undefined in ANY OHLC field of ANY candle never throws and never puts a non-finite number in the result', () => {
  const base = toCandles(bullRows()); const fields = ['open', 'high', 'low', 'close'] as const; let runs = 0, buys = 0;   // the OHLC the rule reads; a bad `time` is a corrupt feed, not an OHLC gap
  for (const bad of [Number.NaN, undefined]) for (const dir of ['bull', 'bear']) for (let i = 0; i < base.length; i++) for (const f of fields) {
    const src = dir === 'bull' ? base : toCandles(mirror(bullRows()));
    const cs = src.map((c) => ({ ...c })); (cs[i] as Record<string, unknown>)[f] = bad;
    let r: StrategyResult | undefined; assert.doesNotThrow(() => { r = detectBosFvg(cs, CTX); }, `${dir} candle ${i}.${f}=${String(bad)} threw`);
    runs++; if (r!.verdict === 'buy' || r!.verdict === 'sell') buys++;
    assert.ok(['buy', 'sell', 'wait'].includes(r!.verdict)); assert.ok(finite(r), `${dir} candle ${i}.${f}=${String(bad)}: a non-finite number in the result: ${JSON.stringify(r)}`);
  }
  assert.ok(runs === 2 * 2 * 30 * 4 && buys > 0, `the sweep ran ${runs} cases and ${buys} still signalled (the harness would be vacuous at 0)`);
});

test('e3. a NaN close on the return candle (the signal candle) is a wait, never a call with a NaN entry', () => {
  const rows = bullRows(); rows[29] = [111, 106, Number.NaN]; assert.equal(detectBosFvg(toCandles(rows), CTX).verdict, 'wait');
});

/* ---------------- registry integration ---------------- */

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const defaults: Record<string, string> = JSON.parse(read('lib/labelDefaults.en.json'));
const KEYS = ['STRAT_BOS_FVG_NAME', 'STRAT_BOS_FVG_DESC', 'STRAT_BOS_FVG_BUY', 'STRAT_BOS_FVG_SELL', 'STRAT_BOS_FVG_WAIT', 'STRAT_TIP_BOS_FVG', 'STRAT_OV_BOS'];

test('r1. the id appears exactly once in the registry, once in the strategy groups (Price action, after fvg) and once in the tips map; an unknown id is treated as none', () => {
  assert.equal(STRATEGIES.filter((s) => s.id === 'bos_fvg').length, 1); assert.ok(STRATEGY_IDS.has('bos_fvg')); assert.equal(findStrategy('bos_fvg'), BOS_FVG);
  const inGroups = STRATEGY_GROUPS.filter((g) => g.ids.includes('bos_fvg')); assert.deepEqual(inGroups.map((g) => g.id), ['price']);
  assert.equal(STRATEGY_GROUPS.flatMap((g) => [...g.ids]).filter((id) => id === 'bos_fvg').length, 1);
  const price = STRATEGY_GROUPS.find((g) => g.id === 'price')!; assert.equal(price.ids[price.ids.indexOf('fvg') + 1], 'bos_fvg');
  assert.deepEqual([...BOS_FVG.logTfs], ['5m', '15m'], 'the description says best on 5m-15m'); assert.equal(STRATEGY_TIP_KEYS.bos_fvg, 'STRAT_TIP_BOS_FVG'); assert.equal(Object.keys(STRATEGY_TIP_KEYS).filter((k) => k === 'bos_fvg').length, 1);
  for (const id of ['nope', 'BOS_FVG', 'bos-fvg', '', null, undefined]) assert.equal(findStrategy(id as string | null | undefined), undefined, `${String(id)} must be unknown`);
  assert.equal(STRATEGY_IDS.has('BOS_FVG'), false);
});

test('r2. /api/settings validates arena_strategy against the registry (STRATEGY_IDS), so bos_fvg is accepted and an unknown id is a 400; the arena page only trusts a stored id findStrategy knows', () => {
  const route = read('app/api/settings/route.ts');
  assert.match(route, /import \{ STRATEGY_IDS \} from '@\/lib\/strategies';/); assert.match(route, /a !== null && !\(typeof a === 'string' && STRATEGY_IDS\.has\(a\)\)/); assert.match(route, /Invalid arena_strategy/);
  assert.match(read('app/(main)/arena/page.tsx'), /if \(findStrategy\(settings\.arena_strategy\)\) setArenaStrategyState\(settings\.arena_strategy\);/);
});

test('r2b. the server fire log writes strat_bos_fvg_<tf> on its logged timeframes (5m, 15m), and the outcome resolver accepts those rule keys', () => {
  for (const tf of BOS_FVG.logTfs) assert.equal(isStrategyRuleKey(`strat_${BOS_FVG.id}_${tf}`), true, `strat_bos_fvg_${tf} is not a strategy rule key`);
  assert.equal(isStrategyRuleKey('strat_bos_fvg_3m'), false);
  assert.match(read('app/api/strategies/track/route.ts'), /for \(const def of STRATEGIES\) \{\s*for \(const tf of def\.logTfs\)/);
});

test('r3. every user-visible string of the strategy is a label key (in LABEL_KEYS, once) with a non-empty English default, and the strategy def names exactly these keys', () => {
  for (const k of KEYS) { assert.equal(LABEL_KEYS.filter((x) => x === k).length, 1, `${k} must be in LABEL_KEYS exactly once`); assert.ok(typeof defaults[k] === 'string' && defaults[k].trim().length > 0, `${k} has no English default`); }
  assert.deepEqual([BOS_FVG.nameKey, BOS_FVG.descKey, BOS_FVG.reasonBuyKey, BOS_FVG.reasonSellKey, BOS_FVG.reasonWaitKey], KEYS.slice(0, 5));
  const keysInResult = [bull(), bear(), bull({ fill: 9, noReturn: true })].flatMap((r) => [...(r.overlay?.levels ?? []), ...(r.overlay?.zones ?? [])].map((x) => x.labelKey));
  const known = new Set<string>(LABEL_KEYS); for (const k of keysInResult) assert.ok(known.has(k) && typeof defaults[k] === 'string', `the chart label ${k} has no label key or default`);
});

test('r4. the BUY / SELL sentences get a value for every placeholder from the call params (no raw {x}, no NaN in the shown text)', () => {
  const fill = (s: string, params: Record<string, number | boolean>) => s.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? String(params[k]) : `<<MISSING ${k}>>`));
  for (const [key, r] of [['STRAT_BOS_FVG_BUY', bull()], ['STRAT_BOS_FVG_SELL', bear()]] as const) {
    assert.ok(r.verdict !== 'wait'); const text = fill(defaults[key], r.params);
    assert.equal(/MISSING|\{|\}|NaN|undefined|Infinity/.test(text), false, `${key}: ${text}`);
  }
  assert.equal(fill(defaults.STRAT_BOS_FVG_BUY, bull().params), 'Closed above the swing high 110; first return into the gap 104-107, closed above its bottom.');
  assert.equal(fill(defaults.STRAT_BOS_FVG_SELL, bear().params), 'Closed below the swing low 90; first return into the gap 93-96, closed below its top.');
  assert.equal(/\{/.test(defaults.STRAT_BOS_FVG_WAIT), false, 'the WAIT sentence takes no params (the card passes none)');
});

/* ---------------- migration 20261119o ---------------- */

const sql = read('supabase/migrations/20261119o_labels_strategy_bos_fvg.sql');
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];
const block = (table: string) => { const i = sql.indexOf(`insert into ${table} (key, locale, value) values`); assert.ok(i > 0, `no insert into ${table}`); const j = sql.indexOf('on conflict', i); return sql.slice(i, j); };
const rows = (b: string) => [...b.matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((m) => ({ key: m[1], locale: m[2], value: m[3].replace(/''/g, "'") }));

test('m1. migration 20261119o: PROD (lhq_labels) and DEV (lhq_dev_labels) blocks are identical, 7 keys x 5 locales, each exactly once', () => {
  const prod = rows(block('lhq_labels')), dev = rows(block('lhq_dev_labels'));
  assert.equal(prod.length, 35); assert.deepEqual(prod, dev, 'PROD and DEV blocks differ');
  for (const k of KEYS) for (const l of LOCALES) assert.equal(prod.filter((r) => r.key === k && r.locale === l).length, 1, `${k}/${l} must appear exactly once`);
  assert.deepEqual([...new Set(prod.map((r) => r.key))].sort(), [...KEYS].sort(), 'the file adds a key this test does not know, or misses one');
  assert.equal(prod.every((r) => r.value.trim().length > 0), true);
  /* both blocks end with the idempotent upsert, and the header says it is not applied anywhere yet */
  assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
  assert.equal(/insert into lhq_dev_labels[\s\S]*insert into lhq_labels/.test(sql), false, 'the PROD block must come first and the DEV block second');
});

test('m2. migration en values equal lib/labelDefaults.en.json (unless a LATER held migration re-states the key), and every key is a LABEL_KEY', () => {
  const prod = rows(block('lhq_labels')); const known = new Set<string>(LABEL_KEYS);
  /* a key this migration set that a later migration (by file name) states again is judged by the LATER one (the latest row wins in the table, and the shipped default follows it): #2603's 20261119z9 re-states STRAT_BOS_FVG_DESC */
  const dir = new URL('../supabase/migrations/', import.meta.url); const later = readdirSync(dir).filter((f) => f > '20261119o_' && f.endsWith('.sql') && /labels/.test(f)).map((f) => readFileSync(new URL(f, dir), 'utf8'));
  const restated = (k: string) => later.some((t) => t.includes(`'${k}'`));
  for (const k of KEYS) { if (restated(k)) { assert.ok(known.has(k), `${k} is not in LABEL_KEYS`); continue; } assert.equal(prod.find((r) => r.key === k && r.locale === 'en')!.value, defaults[k], `${k}: the en row differs from the shipped default`); assert.ok(known.has(k), `${k} is not in LABEL_KEYS`); }
});

test('m3. every {placeholder} of the English text is kept, with the same names, in every locale; and no locale invents one', () => {
  const prod = rows(block('lhq_labels')); const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of KEYS) { const en = ph(prod.find((r) => r.key === k && r.locale === 'en')!.value); for (const l of LOCALES) assert.equal(ph(prod.find((r) => r.key === k && r.locale === l)!.value), en, `${k}/${l}: placeholders differ from en`); }
  assert.equal(ph(defaults.STRAT_BOS_FVG_BUY), 'bos,gapHi,gapLo'); assert.equal(ph(defaults.STRAT_BOS_FVG_SELL), 'bos,gapHi,gapLo'); assert.equal(ph(defaults.STRAT_BOS_FVG_WAIT), '');
});

test('m4. the SQL has no string-literal hazards: 35 rows per block, each value free of a backslash (quotes are closed and brackets balanced: migrationsSqlShape.test.mts S1-S4)', () => {
  for (const t of ['lhq_labels', 'lhq_dev_labels']) { const b = block(t); assert.equal(rows(b).length, 35); assert.equal(/\\/.test(b), false, 'a backslash in a label value'); }
});

/* ---------------- copy rules ---------------- */

test('c1. copy: no AI vendor or model name, no promise of a forecast or an instruction to trade, in any of the 35 strings or the strategy defaults', () => {
  const all = rows(block('lhq_labels')).map((r) => `${r.key}/${r.locale}: ${r.value}`).concat(KEYS.map((k) => `${k}/default: ${defaults[k]}`));
  const vendor = /\b(grok|xai|x\.ai|openai|chatgpt|gpt|anthropic|claude|gemini|llama|mistral|perplexity|deepseek)\b/i;
  const promise = /\b(will|going to|guarantee[ds]?|guaranteed|certain|sure thing|buy now|sell now|enter now|must|should|profit|win rate|predict\w*|forecast\w*)\b/i;
  const hits = all.filter((s) => vendor.test(s) || promise.test(s)); assert.deepEqual(hits, []);
  assert.equal(all.length, 42);
});
