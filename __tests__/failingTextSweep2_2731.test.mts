/* QA: PR #2731 (failing-text sweep 2), a failed REFRESH keeps the last good value and shows no failure line; only a first load with nothing on screen shows one.
 *
 * THE WRITTEN RULES (owner: "last good value, not a failure line"; the literals below come from these, never from the code under test):
 *   C1  the chart loaded, then a kline refresh fails (any of the three failure paths): the candles stay (the load answers with the SAME bars) and the "Couldn't load price history" flag is never raised
 *   C2  the first load fails and there are no candles to keep (also: the kept candles belong to ANOTHER timeframe): the flag IS raised and the chart is told "no candles" (unchanged)
 *   C3  controls: an upstream that answers OK with a genuinely empty list is not "failed" (Bybit-only coin); a good load clears the flag first and sets no failure
 *   J1  the journal loaded trades and a re-read fails: the loaded trades stay (setTrades is not called) and tradesError, which is what draws the "Couldn't load your trades" card, is NOT raised
 *   J2  the first journal read fails with no trades: tradesError IS raised and the loading state ends (unchanged)
 *   J3  controls: a good read replaces the trades and clears the error first; the retry of a failed first read can recover
 *   S   the shape both rules depend on (anchored): the chart raises the flag in exactly three places, each behind "nothing was kept"; loadTrades is a plain function of the component body (a stale `trades` would make the rule read an old list)
 *
 * HOW: the REAL code is cut out of the source with brace matching (the chart's getBars, the journal's loadTrades), its types stripped with node's own stripTypeScriptTypes, and run with stand-ins for everything it reaches (refs, setters, the klines fetch). A
 * mutation of the app file that breaks a rule turns the named test red; each test was mutation-checked on a scratch copy.
 * WHAT THIS CANNOT PROVE: that the line / the card is drawn or absent on screen, and the refresh trigger in a browser (qa/e2e/failing-text-2731.spec.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/* ── a brace matcher that knows strings, templates, comments and regex literals ─────────────────────────────────────────────── */
function matchBrace(src: string, open: number): number {
  assert.equal(src[open], '{', 'matchBrace: not on an opening brace');
  const stack: Array<'{' | '`'> = ['{'];                       // a '{' frame, or a template literal frame
  let prev = '{';                                                // last significant char, to tell a regex literal from a division
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i], top = stack[stack.length - 1];
    if (top === '`') {                                           // inside a template literal
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { stack.pop(); prev = '`'; continue; }
      if (ch === '$' && src[i + 1] === '{') { stack.push('{'); prev = '{'; i++; }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; assert.ok(i > 0, 'matchBrace: unterminated comment'); continue; }
    if (ch === '"' || ch === "'") { for (i++; src[i] !== ch; i++) { if (src[i] === '\\') i++; assert.ok(i < src.length, 'matchBrace: unterminated string'); } prev = ch; continue; }
    if (ch === '`') { stack.push('`'); continue; }
    if (ch === '/' && /[(,=:[!&|?{};]/.test(prev)) {            // a regex literal
      let inClass = false;
      for (i++; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) break; }
      prev = '/'; continue;
    }
    if (ch === '{') { stack.push('{'); prev = ch; continue; }
    if (ch === '}') { stack.pop(); if (stack.length === 0) return i; prev = ch; continue; }
    if (!/\s/.test(ch)) prev = ch;
  }
  throw new Error('matchBrace: no closing brace');
}

/** the text between the first `{` after `anchor` and its matching `}`; the anchor must occur exactly once */
function cutBody(src: string, anchor: string, label: string): string {
  const n = src.split(anchor).length - 1;
  assert.equal(n, 1, `${label}: the anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  const open = src.indexOf('{', src.indexOf(anchor) + anchor.length - 1);
  return src.slice(open + 1, matchBrace(src, open));
}

/** compile a function whose free identifiers resolve ONLY against `scope` (then real globals); a missing stand-in is a ReferenceError, loud */
function compileIn(fnSource: string, scope: Record<string, unknown>): (...a: unknown[]) => unknown {
  const js = stripTypeScriptTypes(`const __f = ${fnSource};`).replace(/^const __f = /, '').replace(/;\s*$/, '');
  const proxy = new Proxy(scope, { has: (t, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(t, k), get: (t, k) => (t as Record<string | symbol, unknown>)[k] });
  return new Function('__scope', `with (__scope) { return (${js}); }`)(proxy) as (...a: unknown[]) => unknown;
}

/* planted-defect controls for the tools above, so a green run cannot be a matcher that matches nothing */
test('T0. the brace matcher and the scope compiler can fail: they stop at the right brace through strings / templates / regexes / comments, and a missing stand-in throws', () => {
  const tricky = "{ const a = '}'; const b = `x${ { y: '}' }.y }}`; const re = /[}]\\//; // } \n /* } */ return a + b; } TAIL";
  assert.equal(tricky.slice(matchBrace(tricky, 0) + 1), ' TAIL', 'the matcher stopped at the wrong brace');
  assert.throws(() => matchBrace('{ { }', 0), /no closing brace/, 'control: an unbalanced block must not match');
  assert.throws(() => (compileIn('() => missingStandIn', {}) as () => unknown)(), ReferenceError, 'control: a free identifier with no stand-in must be a ReferenceError');
  assert.equal((compileIn('(n: number): number => n + k', { k: 2 }) as (n: number) => number)(1), 3, 'control: types are stripped and the scope is used');
});

/* ══ the chart: the real getBars, run with stand-ins ═════════════════════════════════════════════════════════════════════════ */
const CHART = read('components/KLineProChart.tsx');
const GETBARS_ANCHOR = "getBars: async ({ symbol, period, callback, type, timestamp }) => {";
const GETBARS_SRC = `async ({ symbol, period, callback, type, timestamp }) => {${cutBody(CHART, GETBARS_ANCHOR, 'the chart getBars')}}`;

type Bar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
interface World {
  venues: { binance: string | null; bybit: string | null };
  bybit: 'ok' | 'null' | 'empty' | 'throw';          // fetchBybitKlinesRetry: bars / null (every attempt refused) / ok-but-empty / throws
  binance: 'ok' | 'fail';                            // /api/market/klines for the Binance legs
  period: { span: number; type: string };
}
const HOUR = { span: 1, type: 'hour' }, FOUR_HOUR = { span: 4, type: 'hour' };
const GOOD = [['1700000000000', '1', '2', '0.5', '1.5', '10'], ['1700003600000', '1.5', '2.5', '1', '2', '11'], ['1700007200000', '2', '3', '1.5', '2.5', '12']];

function chartHarness(world: World) {
  const failedCalls: boolean[] = [];
  const cbs: Array<{ bars: Bar[]; more: unknown }> = [];
  const refs = {
    coinRef: { current: 'btc' }, loadGenRef: { current: 1 }, deliveredGenRef: { current: 0 }, lastGoodRef: { current: null as null | { key: string; bars: Bar[] } },
    historyRetryRef: { current: 0 }, lastCloseRef: { current: 0 }, srSetRef: { current: (_: unknown) => {} }, paSetRef: { current: (_: unknown) => {} },
    emaBarsRef: { current: [] as Bar[] }, olderInFlightRef: { current: false }, histSourceRef: { current: '' },
  };
  const scope: Record<string, unknown> = {
    ...refs,
    venueSymbols: () => world.venues,
    setHistoryFailed: (v: boolean) => { failedCalls.push(v); },
    setHistoryViaServerBybitFallback: () => {}, setLoadingTf: () => {}, setBarsTick: () => {}, endFade: () => {}, syncEmaRibbon: () => {},
    computeSRLevels: () => [], detectStructureSignals: () => [], PA_MAX: 5,
    periodToBybitInterval: () => '60', periodToBnInterval: () => '1h', HISTORY_ATTEMPT_TIMEOUT_MS: 1_000, deadlineSignal: () => undefined,
    fetchBybitKlinesRetry: async () => {
      if (world.bybit === 'throw') throw new Error('stand-in: network down');
      if (world.bybit === 'null') return null;
      return { result: { list: world.bybit === 'empty' ? [] : [...GOOD].reverse() } };      // Bybit answers newest first
    },
    fetch: async () => world.binance === 'ok'
      ? { ok: true, json: async () => GOOD.map(r => [...r]), headers: { get: () => null } }
      : { ok: false, json: async () => ({}), headers: { get: () => null } },
    console: { error: () => {}, warn: () => {}, log: () => {} },
  };
  const getBarsFn = compileIn(GETBARS_SRC, scope) as (a: unknown) => Promise<void>;
  return {
    failedCalls, cbs, refs,
    load: () => getBarsFn({ symbol: { ticker: 'BTC' }, period: world.period, callback: (bars: Bar[], more: unknown) => { cbs.push({ bars, more }); }, type: 'init', timestamp: null }),
  };
}
const raised = (h: { failedCalls: boolean[] }, from: number) => h.failedCalls.slice(from).filter(v => v === true).length;

type Site = { name: string; venues: World['venues']; failing: Pick<World, 'bybit' | 'binance'> };
const SITES: Site[] = [
  { name: 'Bybit-only coin, every Bybit attempt refused', venues: { binance: null, bybit: 'XBTUSDT' }, failing: { bybit: 'null', binance: 'fail' } },
  { name: 'Bybit refused and Binance spot + futures both empty', venues: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, failing: { bybit: 'null', binance: 'fail' } },
  { name: 'the load throws (the catch)', venues: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, failing: { bybit: 'throw', binance: 'fail' } },
];

for (const [i, site] of SITES.entries()) {
  test(`C1.${i + 1} the chart loaded, then a refresh fails (${site.name}): the SAME candles come back and the failure flag is never raised`, async () => {
    const world: World = { venues: site.venues, bybit: 'ok', binance: 'ok', period: HOUR };
    const h = chartHarness(world);
    await h.load();
    assert.equal(h.cbs.length, 1, 'CONTROL: the first (good) load must answer once');
    assert.equal(h.cbs[0].bars.length, 3, 'CONTROL: the first load must carry the three stand-in candles');
    assert.equal(raised(h, 0), 0, 'CONTROL: a good load must not raise the failure flag');
    const first = h.cbs[0].bars, mark = h.failedCalls.length;
    Object.assign(world, site.failing);
    await h.load();
    assert.equal(h.cbs.length, 2, 'the failed refresh did not answer the chart at all');
    assert.equal(h.cbs[1].bars.length, 3, 'a failed refresh must keep the candles: it answered with ' + h.cbs[1].bars.length + ' bars');
    assert.deepEqual(h.cbs[1].bars, first, 'the chart was handed different candles than the last good ones');
    assert.equal(raised(h, mark), 0, 'a failed refresh that kept the last good candles raised the "Couldn\'t load price history" flag');
  });

  test(`C2.${i + 1} the first load fails with nothing to keep (${site.name}): the failure flag IS raised and the chart is told "no candles"`, async () => {
    const world: World = { venues: site.venues, ...site.failing, period: HOUR };
    const h = chartHarness(world);
    await h.load();
    assert.equal(raised(h, 0), 1, 'the first load failed with no candles and the failure line was not raised exactly once');
    assert.equal(h.cbs.length, 1);
    assert.equal(h.cbs[0].bars.length, 0, 'the chart was handed candles although every source failed');
  });
}

test('C2.4 the kept candles belong to ANOTHER timeframe: a failed load of this one has nothing to keep, so the line shows (the 1h candles are not shown as the 4h chart)', async () => {
  const world: World = { venues: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, bybit: 'ok', binance: 'ok', period: HOUR };
  const h = chartHarness(world);
  await h.load();
  assert.equal(h.refs.lastGoodRef.current?.bars.length, 3, 'CONTROL: the 1h load did not become the last good');
  Object.assign(world, { bybit: 'null', binance: 'fail', period: FOUR_HOUR });
  const mark = h.failedCalls.length;
  await h.load();
  assert.equal(raised(h, mark), 1, 'a failed 4h load kept 1h candles, or raised no failure line');
  assert.equal(h.cbs[h.cbs.length - 1].bars.length, 0);
});

test('C3. controls: an upstream that answers OK with a genuinely empty list is not a failure; a good load clears the flag first and raises none', async () => {
  const world: World = { venues: { binance: null, bybit: 'XBTUSDT' }, bybit: 'empty', binance: 'ok', period: HOUR };
  const h = chartHarness(world);
  await h.load();
  assert.equal(raised(h, 0), 0, 'a coin that genuinely has no candles must not read as a failed load');
  assert.equal(h.cbs[0].bars.length, 0);
  const good = chartHarness({ venues: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, bybit: 'ok', binance: 'ok', period: HOUR });
  await good.load();
  assert.deepEqual(good.failedCalls, [false], 'a good load must clear the flag first and raise nothing');
});

test('S1. the chart raises the failure flag in exactly three places, none of them unguarded', () => {
  const body = cutBody(CHART, GETBARS_ANCHOR, 'the chart getBars');
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const raises = [...code.matchAll(/setHistoryFailed\(true\)/g)];
  assert.equal(raises.length, 3, `setHistoryFailed(true) is raised ${raises.length} time(s) in getBars, the rule names three (Bybit-only, all sources empty, the catch)`);
  for (const m of raises) {
    const before = code.slice(Math.max(0, m.index! - 160), m.index!);
    assert.match(before, /(keepLastGood\(\)|json === null|bars\.length === 0)/, `a failure flag is raised with no "nothing was kept / nothing came back" test in front of it: ...${JSON.stringify(before.slice(-90))}`);
  }
});

/* ══ the journal: the real loadTrades, run with stand-ins ═══════════════════════════════════════════════════════════════════ */
const JOURNAL = read('components/TradeJournal.tsx');
const LOAD_ANCHOR = 'const loadTrades = async () => {';
const LOAD_SRC = `async () => {${cutBody(JOURNAL, LOAD_ANCHOR, 'the journal loadTrades')}}`;
const T1 = { id: 'a', coin: 'btc', direction: 'LONG', setup_type: 'Other', entry_price: 65000, stop_loss: 64000, result: 'OPEN' };
const T2 = { ...T1, id: 'b' };

function journalHarness(trades: unknown[], read: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown]> = [];
  const scope: Record<string, unknown> = {
    getSupabase: () => ({}), trades,
    setNoDb: (v: unknown) => calls.push(['setNoDb', v]), setLoading: (v: unknown) => calls.push(['setLoading', v]),
    setTradesError: (v: unknown) => calls.push(['setTradesError', v]), setTrades: (v: unknown) => calls.push(['setTrades', v]),
    readTradesWithRetry: async () => read,
  };
  return { calls, run: compileIn(LOAD_SRC, scope) as () => Promise<void> };
}
const BOOM = { message: 'stand-in: read failed' };

test('J1. a re-read fails while trades are loaded: the trades stay and the "Couldn\'t load your trades" state is NOT raised', async () => {
  const h = journalHarness([T1, T2], { data: null, error: BOOM });
  await h.run();
  assert.equal(h.calls.some(([n, v]) => n === 'setTradesError' && v === true), false, 'tradesError was raised over trades that are on screen');
  assert.equal(h.calls.some(([n]) => n === 'setTrades'), false, 'the loaded trades were replaced by a failed read');
  assert.deepEqual(h.calls[h.calls.length - 1], ['setLoading', false], 'the loading state did not end after the failed re-read');
});

test('J2. the FIRST read fails with no trades: the error state IS raised, nothing is put in the list, loading ends', async () => {
  const h = journalHarness([], { data: null, error: BOOM });
  await h.run();
  assert.ok(h.calls.some(([n, v]) => n === 'setTradesError' && v === true), 'a failed first read raised no error state (the page would read "no trades yet")');
  assert.equal(h.calls.some(([n]) => n === 'setTrades'), false);
  assert.deepEqual(h.calls[h.calls.length - 1], ['setLoading', false]);
});

test('J3. controls: a good read replaces the trades and clears the error first; the stand-in can fail and can succeed', async () => {
  const ok = journalHarness([T1], { data: [T1, T2], error: null });
  await ok.run();
  const setTradesCall = ok.calls.find(([n]) => n === 'setTrades');
  assert.deepEqual(setTradesCall?.[1], [T1, T2], 'a good read did not set the trades');
  assert.deepEqual(ok.calls.filter(([n]) => n === 'setTradesError'), [['setTradesError', false]], 'a good read must clear the error first and raise none');
  const retry = journalHarness([], { data: [T1], error: null });   // the retry button after a failed first read
  await retry.run();
  assert.deepEqual(retry.calls.find(([n]) => n === 'setTrades')?.[1], [T1], 'the retry of a failed first read cannot recover');
});

test('S2. loadTrades is a plain function of the component body: `trades` in it is the current render\'s list, not a stale capture', () => {
  assert.equal(JOURNAL.split(LOAD_ANCHOR).length - 1, 1);
  const at = JOURNAL.indexOf(LOAD_ANCHOR);
  assert.doesNotMatch(JOURNAL.slice(Math.max(0, at - 40), at), /useCallback\(|useMemo\(/, 'loadTrades is wrapped in a hook: its `trades` may be an old render\'s empty list, which would raise the error over loaded trades');
  const body = cutBody(JOURNAL, LOAD_ANCHOR, 'loadTrades');
  assert.match(body, /\btrades\.length\b/, 'the re-read rule reads no `trades.length` - the failed re-read can no longer tell a first read from a re-read');
});
