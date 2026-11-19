import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastGoodAge, readLastGood, writeLastGood } from '../lib/lastGoodAge.ts';

/* #2683 (#1185 audit B2 B4 B5 B7-B10 B16-B19, C1 C6-C8 C12 C13 C19, owner's feature-freeze order): A FAILED READ KEEPS THE LAST GOOD VALUE WITH ITS AGE, RETRIES QUIETLY, AND PRINTS NO FAILURE TEXT. Written rule (PR body), pinned where it is code that can be run:
 *   L  lastGoodAge: just now <60 s, N min <1 h, N h <1 day, else N days, clamped at 0; readLastGood returns null for anything but {v, ts}; storage failures are harmless
 *   R  retry schedules: alerts mute prefs 3/10/30 s (then the line), hypotheses 3 then 10 s (then the line), journal trades 2 s then 6 s (three tries), settings subscription 3/10/30 s then every minute (never a line), econ calendar and the news Events tab 5/15/45 s then every minute
 *   G  gates: the /econ-calendar red line only with nothing saved to show; the news Events tab says "No upcoming events" only when the provider is trusted or the second source answered; Cycle and Volatility cards hide when there is nothing; Btc risk hides after the wait; the dry-powder card never prints $0.0B/NaN (a missing field is a failed read)
 *   S  the status page keeps the reading on screen on a failed AUTOMATIC read, and shows Unknown on a first or manual failure
 *   F  no component renders the retired failure sentences
 * The REAL functions are cut out of the sources and run with stand-ins. NOT covered (browser cells): layout when a card hides, the retries on a live network. */
const rd = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };
const ev = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));
const dig = (x: string) => x.replace(/(d)_(?=d)/g, '$1');
const num = (arr: string) => ev(dig(arr), {}) as number[];
const bools = [false, true];
const alerts = strip(rd('app/(main)/alerts/page.tsx')), econ = strip(rd('app/(main)/econ-calendar/page.tsx')), news = strip(rd('app/(main)/news/page.tsx')), settings = strip(rd('app/(main)/settings/page.tsx')), status = strip(rd('app/(main)/status/page.tsx'));
const cycle = strip(rd('components/CycleChart.tsx')), vol = strip(rd('components/VolatilityRegime.tsx')), hyp = strip(rd('components/HypothesisTracker.tsx')), journal = strip(rd('components/TradeJournal.tsx')), dp = strip(rd('components/DryPowder.tsx')), risk = strip(rd('components/BtcRiskLevel.tsx'));

test('L1. lastGoodAge: just now, N min, N h, N days, clamped at 0', () => {
  const t = (k: string, v?: { n: number }) => (v ? `${k}:${v.n}` : k); const now = 10_000_000_000;
  for (const [ageS, want] of [[-30, 'NEWS_TIME_JUST_NOW'], [0, 'NEWS_TIME_JUST_NOW'], [59, 'NEWS_TIME_JUST_NOW'], [60, 'NEWS_TIME_MINUTES_AGO:1'], [3599, 'NEWS_TIME_MINUTES_AGO:59'], [3600, 'NEWS_TIME_HOURS_AGO:1'], [86_399, 'NEWS_TIME_HOURS_AGO:23'], [86_400, 'NEWS_TIME_DAYS_AGO:1'], [5 * 86_400 + 7, 'NEWS_TIME_DAYS_AGO:5']] as const) assert.equal(lastGoodAge(now - ageS * 1000, t as never, now), want, `${ageS} s`);
});
test('L2. read/writeLastGood: {v, ts} only; corrupt, empty-value or blocked storage is harmless', () => {
  const store: Record<string, string> = {}; let blocked = false;
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => { if (blocked) throw new Error('blocked'); return store[k] ?? null; }, setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); store[k] = v; } };
  try {
    assert.equal(readLastGood('k'), null); const before = Date.now(); writeLastGood('k', { a: 1 }); const got = readLastGood<{ a: number }>('k')!; assert.deepEqual(got.v, { a: 1 }); assert.ok(got.ts >= before && got.ts <= Date.now());
    store.k = '{nope'; assert.equal(readLastGood('k'), null); store.k = JSON.stringify({ v: null, ts: 1 }); assert.equal(readLastGood('k'), null, 'a null value is not a reading'); store.k = JSON.stringify({ v: 1, ts: 'x' }); assert.equal(readLastGood('k'), null); store.k = JSON.stringify({ v: 0, ts: 5 }); assert.deepEqual(readLastGood('k'), { v: 0, ts: 5 }, 'zero is a value');
    blocked = true; assert.equal(readLastGood('k'), null); assert.doesNotThrow(() => writeLastGood('k', 1));
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test('R1. alerts mute prefs: three quiet retries (3/10/30 s) then the line; a good read resets the count; the bot status waits 4/12/30 s', () => {
  assert.deepEqual(num(must(alerts, /const LOAD_RETRY_MS = (\[[^\]]+\]);/, 'LOAD_RETRY_MS')), [3000, 10000, 30000]); assert.deepEqual(num(must(alerts, /const BOT_INFO_RETRY_MS = (\[[^\]]+\]);/, 'BOT_INFO_RETRY_MS')), [4000, 12000, 30000]);
  const fn = must(alerts, /const retryMuteLater = useCallback\(\(\): boolean => \{([\s\S]*?)\n  \}, \[\]\);/, 'retryMuteLater'); const waits: number[] = []; const muteAttempt = { current: 0 }; const muteTimer = { current: undefined as unknown }; const loadMuteRef = { current: () => undefined }; const LOAD_RETRY_MS = [3000, 10000, 30000];
  const run = () => new Function('muteAttempt', 'muteTimer', 'loadMuteRef', 'LOAD_RETRY_MS', 'setTimeout', fn)(muteAttempt, muteTimer, loadMuteRef, LOAD_RETRY_MS, (_f: unknown, ms: number) => { waits.push(ms); return 1; }) as boolean;
  assert.deepEqual([run(), run(), run(), run(), run()], [true, true, true, false, false], 'three retries, then it reports the line is due'); assert.deepEqual(waits, [3000, 10000, 30000]);
  assert.match(alerts, /\.then\(\(\) => \{ muteAttempt\.current = 0; \}\)/, 'a good read must reset the retry count'); assert.match(alerts, /if \(!token\) \{ if \(!retryMuteLater\(\)\) \{ setMuteLoadFailed\(true\); setMutedLoaded\(true\); \} return; \}/); assert.match(alerts, /if \(muteFailed && retryMuteLater\(\)\) return;\s*if \(muteFailed\) setMuteLoadFailed\(true\);/);
  const delay = must(alerts, /setTimeout\(\(\) => \{ void loadPriceAlerts\(\); \}, (LOAD_RETRY_MS\[paFailTick - 1\] \?\? 60_000)\)/, 'price alert retry delay'); for (const [tick, want] of [[1, 3000], [2, 10000], [3, 30000], [4, 60000], [9, 60000]] as const) assert.equal(ev(dig(delay), { LOAD_RETRY_MS, paFailTick: tick }), want);
  assert.match(alerts, /if \(attempt < BOT_INFO_RETRY_MS\.length\) \{ timer = setTimeout\(load, BOT_INFO_RETRY_MS\[attempt\]\); attempt \+= 1; return; \}\s*setBotStatusUnavailable\(true\);/, 'the bot-status line must come only after the retries');
});
test('R2. hypotheses: two quiet retries (3 s, 10 s), then the error; the list stays on a failed refresh', () => {
  const fn = must(hyp, /const failRead = \(\): boolean => \{([\s\S]*?)\n    \};/, 'failRead'); const waits: number[] = []; const errors: string[] = []; const hypAttempt = { current: 0 }; const hypTimer = { current: undefined as unknown };
  const run = () => new Function('hypAttempt', 'hypTimer', 'fetchHypRef', 'setTimeout', 'setHypError', 't', fn)(hypAttempt, hypTimer, { current: () => undefined }, (_f: unknown, ms: number) => { waits.push(ms); return 1; }, (e: string) => errors.push(e), (k: string) => k) as boolean;
  assert.deepEqual([run(), run(), run()], [true, true, false]); assert.deepEqual(waits, [3000, 10000]); assert.deepEqual(errors, ['HYPOTHESIS_TRACKER_NETWORK_ERROR']);
  const line = must(hyp, /\{(hypError && !loading && hypotheses\.length === 0) && \(/, 'error line gate'); for (const hypError of ['', 'x']) for (const loading of bools) for (const n of [0, 2]) assert.equal(Boolean(ev(line, { hypError, loading, hypotheses: { length: n } })), !!hypError && !loading && n === 0, 'the error line must show only with nothing to list');
  assert.match(hyp, /hypAttempt\.current = 0;/, 'a good read must reset the count');
});
test('R3. journal trades: three tries, waits 2 s then 6 s, stops at the first good read', async () => {
  const body = must(journal, /(async function readTradesWithRetry\(db[^)]*\) \{[\s\S]*?\n\})\n/, 'readTradesWithRetry').replace(/\(db: [^)]*\)/, '(db)'); const T = { trades: 'trades' }; const make = (results: Array<{ error: unknown; data?: unknown }>, waits: number[]) => { let i = 0; const db = { from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve(results[Math.min(i++, results.length - 1)]) }) }) }) }; return new Function('T', 'JOURNAL_TRADES_LIMIT', 'setTimeout', `${body}\nreturn readTradesWithRetry;`)(T, 50, (f: () => void, ms: number) => { waits.push(ms); f(); }) .bind(null, db) as () => Promise<{ error: unknown }>; };
  let waits: number[] = []; let r = await make([{ error: 'x' }, { error: 'x' }, { error: 'x' }], waits)(); assert.deepEqual(waits, [2000, 6000]); assert.ok(r.error, 'all three failed: the error reaches the page');
  waits = []; r = await make([{ error: 'x' }, { error: null, data: [1] }], waits)(); assert.deepEqual(waits, [2000]); assert.equal(r.error, null, 'a good second read wins');
  waits = []; r = await make([{ error: null, data: [] }], waits)(); assert.deepEqual(waits, [], 'a good first read must not wait');
});
test('R4. settings subscription retries 3/10/30 s then every minute and never prints; one quiet retry before the Telegram "Couldn\'t check"', () => {
  const d = must(settings, /setTimeout\(\(\) => \{ void load\(\); \}, (\[3_000, 10_000, 30_000\]\[attempt\] \?\? 60_000)\)/, 'subscription retry'); for (const [attempt, want] of [[0, 3000], [1, 10000], [2, 30000], [3, 60000], [10, 60000]] as const) assert.equal(ev(dig(d), { attempt }), want);
  assert.match(settings, /if \(!tgAutoRetried\.current\) \{\s*tgAutoRetried\.current = true;\s*autoRetryTimer = setTimeout\(\(\) => setTgAttempt\(n => n \+ 1\), 3_000\);\s*return;\s*\}\s*setTgRead\(\{ uid, status: 'error' \}\);/, 'the Telegram check must retry once quietly, then show the line');
});
test('R5. /econ-calendar and the news Events tab: retries 5/15/45 s then every minute; saved calendar kept up to 7 days; the red line only with nothing to show', () => {
  for (const [src, what] of [[econ, 'econ'], [news, 'news']] as const) { assert.deepEqual(num(must(src, /const RETRY_DELAYS_MS = (\[[^\]]+\]);/, `${what} delays`)), [5000, 15000, 45000]); assert.equal(must(src, /const RETRY_STEADY_MS = ([\d_]+);/, `${what} steady`).replace(/_/g, ''), '60000'); assert.match(src, /setTimeout\(load, RETRY_DELAYS_MS\[attempt\] \?\? RETRY_STEADY_MS\)/); assert.match(src, /deadlineSignal\(10_000\)/); }
  assert.equal(must(econ, /const LAST_GOOD_MAX_AGE_MS = ([^;]+);/, 'econ max age'), '7 * 24 * 3_600_000'); assert.match(econ, /saved\.v\.events\.length > 0 && Date\.now\(\) - saved\.ts < LAST_GOOD_MAX_AGE_MS/); assert.match(econ, /if \(cal\.events\.length > 0\) writeLastGood\(LAST_GOOD_KEY/, 'an empty calendar must never overwrite the saved one');
  const red = must(econ, /\{(failed && sorted\.length === 0) && \(/, 'red line gate'); for (const failed of bools) for (const n of [0, 4]) assert.equal(ev(red, { failed, sorted: { length: n } }), failed && n === 0, 'the red line must show only with nothing saved to show');
  const trusted = must(news, /const providerTrusted = (.+?);\n/, 'providerTrusted'); const emptyTrue = must(news, /const econEmptyIsTrue = (.+?);\n/, 'econEmptyIsTrue'); const needed = must(news, /useEconRouteFallback\((.+?)\);\n/, 'fallback trigger');
  for (const n of [0, 2]) for (const eventsLoaded of bools) for (const econStale of bools) for (const graceOver of bools) for (const answered of bools) {
    const pt = ev(trusted, { providerEconEvents: { length: n }, eventsLoaded, econStale }) as boolean; assert.equal(pt, n > 0 || (eventsLoaded && !econStale));
    assert.equal(ev(emptyTrue, { providerTrusted: pt, econFallback: { answered } }), pt || answered, 'a false "No upcoming events" must never show for an unanswered, untrusted calendar'); assert.equal(ev(needed, { providerTrusted: pt, eventsLoaded, providerGraceOver: graceOver }), !pt && (eventsLoaded || graceOver));
  }
  assert.match(news, /\{econEvents\.length === 0 && econEmptyIsTrue && \(/, 'the empty line is no longer guarded by econEmptyIsTrue');
});
test('G1. Cycle: hides with nothing saved after the retries, draws the saved copy (day counter advanced); Volatility keeps an aged value and hides only when both are empty; BTC risk hides after the wait', () => {
  assert.deepEqual(num(must(cycle, /const RETRY_MS = (\[[^\]]+\]);/, 'cycle retries')), [3000, 10000, 30000]); assert.equal(must(cycle, /const LAST_GOOD_MAX_AGE_MS = ([^;]+);/, 'cycle max age'), '30 * 86_400_000'); assert.match(cycle, /setData\(\{ \.\.\.saved\.v, currentDay: saved\.v\.currentDay \+ daysSince \}\)/); assert.match(cycle, /if \(!haveSaved\) setGaveUp\(true\);/, 'a saved copy must stay on screen'); assert.match(cycle, /if \(d\.error \|\| !d\['2016'\] \|\| !d\['2020'\] \|\| !d\['2024'\]\) \{ failed\(\); return; \}/, 'a partial answer must count as a failure'); assert.match(cycle, /if \(gaveUp && !data\) return null;/);
  assert.equal(must(vol, /const RETRY_MS = ([\d_]+);/, 'vol retry').replace(/_/g, ''), '60000'); assert.equal(must(vol, /const MAX_RETRIES = (\d+);/, 'vol max'), '2'); assert.match(vol, /const OLD_CACHE_KEY = 'lhq_vol_regime';/); assert.match(vol, /try \{ localStorage\.removeItem\(OLD_CACHE_KEY\); \}/, 'the old key that replayed a failed read for 4 h must be removed');
  assert.match(vol, /if \(btcData\) \{ writeLastGood\(CACHE_KEY_BTC, btcData\); setBtc\(\{ data: btcData, ts: now \}\); \}\s*else if \(needBtc\) setBtc\(prev => \(prev === 'loading' \? null : prev\)\);/, 'a failed read must never be stored and must keep an earlier value'); const upd = must(vol, /else if \(needBtc\) setBtc\((prev => \(prev === 'loading' \? null : prev\))\);/, 'btc failure updater'); const good = { data: {}, ts: 1 }; assert.equal(ev(upd, {})(good), good, 'a failed refresh keeps the value'); assert.equal(ev(upd, {})('loading'), null, 'a coin that never had one is hidden'); assert.equal(ev(upd, {})(null), null);
  assert.match(vol, /if \(btc === null && eth === null\) return null;/); assert.match(vol, /const stale = Date\.now\(\) - ts >= CACHE_TTL;/); assert.match(vol, /if \(!state\) return null;/);
  assert.equal(ev(must(risk, /if \((score == null && graceOver)\) return null;/, 'risk gate'), { score: null, graceOver: true }), true); assert.equal(ev('score == null && graceOver', { score: null, graceOver: false }), false); assert.equal(ev('score == null && graceOver', { score: 40, graceOver: true }), false);
});
test('G2. dry-powder card: a missing figure is a failed read (never $0.0B / NaN); a still-pending summary leaves the summary out, with no failure line', () => {
  const guard = must(dp, /if \((!res\.ok \|\| typeof json\.current !== 'number' \|\| typeof json\.prev30 !== 'number' \|\| typeof json\.prev90 !== 'number')\) \{ showSavedOrError\(\); return; \}/, 'numbers guard');
  for (const [res, json, bad] of [[{ ok: true }, { current: 1, prev30: 1, prev90: 1 }, false], [{ ok: false }, { current: 1, prev30: 1, prev90: 1 }, true], [{ ok: true }, { current: 1, prev30: 1 }, true], [{ ok: true }, { current: '1', prev30: 1, prev90: 1 }, true], [{ ok: true }, { current: 0, prev30: 0, prev90: 0 }, false]] as const) assert.equal(ev(guard, { res, json }), bad, JSON.stringify(json));
  assert.match(dp, /if \(ai\?\.json\.pending\) \{ await new Promise\(r => setTimeout\(r, 20_000\)\); ai = await askAi\(\); \}\s*if \(ai\?\.json\.pending\) \{\s*setState\(prev => \(typeof prev === 'object' && prev !== null \? \{ \.\.\.prev, analysis: 'unavailable' \} : prev\)\);\s*return;\s*\}/, 'a second pending must hide the summary and stop'); assert.match(dp, /d\.analysis !== 'loading' && d\.analysis !== 'unavailable' &&/, 'the unavailable state must not draw the summary body');
});
test('S. the status page keeps its reading on a failed AUTOMATIC read and shows Unknown otherwise; it re-reads every minute while visible', () => {
  const upd = must(status, /\.catch\(\(\) => setReading\((prev => \(quiet && prev \? prev : UNREACHABLE\))\)\)/, 'status catch'); const U = { u: 1 }; const good = { g: 1 };
  assert.equal(ev(upd, { quiet: false, UNREACHABLE: U })(good), U, 'a first or manual failure shows Unknown'); assert.equal(ev(upd, { quiet: true, UNREACHABLE: U })(good), good, 'a quiet failure keeps the reading'); assert.equal(ev(upd, { quiet: true, UNREACHABLE: U })(null), U, 'nothing to keep: Unknown'); assert.equal(ev(upd, { quiet: false, UNREACHABLE: U })(null), U);
  assert.match(status, /fetch\('\/api\/health', \{ cache: 'no-store', signal: deadlineSignal\(10_000\) \}\)/, 'the health read must stay uncached and bounded'); assert.match(status, /setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) run\(true\); \}, 60_000\)/);
});
test('F. no component renders a retired failure sentence', () => {
  for (const [src, key, f] of [[vol, 'VOLATILITY_REGIME_UNAVAILABLE', 'VolatilityRegime'], [cycle, 'CYCLE_CHART_LOAD_ERROR', 'CycleChart'], [settings, 'SETTINGS_SUB_LOAD_FAILED', 'settings'], [dp, 'DRY_POWDER_ANALYSIS_UNAVAILABLE', 'DryPowder']] as const) assert.equal(src.includes(key), false, `${f} renders ${key} again`);
  assert.equal(dp.includes('dry-powder-analysis-unavailable'), false);
});
