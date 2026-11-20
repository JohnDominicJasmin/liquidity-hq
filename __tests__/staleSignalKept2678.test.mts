import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2678 (#1185 audit A10 + A15, owner's feature-freeze order: where real data can be missing show the LAST GOOD value with its AGE, not a failure line). Written rule (PR body):
 *   - useStrategySignal (the Strategy call box): a failed refresh keeps the previous call and marks it `staleSince` = when it was last confirmed; `error` (the "Read unavailable" box) only when there never was a call; the next try is 45 s later (not at the next candle close: 15 min on 15m, 4 h on 4h, 24 h on 1D); a good refresh clears the mark
 *   - useEMAStrategy (the EMA card + the Confluence score's EMA factor): a failed refresh keeps the previous signal with `staleSince`; the red "Signal unavailable right now" only when there never was a signal; a coin/timeframe change or a good refresh clears it
 *   - both cards print the age in the existing freshness labels: under a minute "just now", under an hour "N min ago", else "N h ago"; a clock skew (negative age) reads 0
 * The REAL reducers, the retry-delay expression and the age expression are cut out of the sources and run on tables.
 *   T1 strategy hook reducer   T2 EMA hook reducer   T3 retry delay   T4 only a failure sets the mark, success and resets clear it   T5 the age text in both cards (identical, thresholds)   T6 the render gates */
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };
const ev = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));
const strat = src('lib/useStrategySignal.ts'), ema = src('lib/useEMAStrategy.ts'), emaCard = src('components/EMASignal.tsx'), callBox = src('components/StrategyCallBox.tsx');

test('T1. strategy hook: a failure keeps the previous call with its age; with no call it is the error state; an already-stale call keeps its ORIGINAL time', () => {
  const body = must(strat, /if \(!cancelled\) setState\(prev => (\(!prev\.result \? [\s\S]+?\))\);\n\s*failed = true;/, 'strategy failure reducer');
  const reduce = (prev: Record<string, unknown>, lastOkAt: number) => ev(`((prev) => ${body})`, { lastOkAt })(prev) as Record<string, unknown>;
  const call = { result: { call: 'BUY' }, loading: false, error: false };
  assert.deepEqual(reduce(call, 1000), { result: { call: 'BUY' }, loading: false, error: false, staleSince: 1000 }, 'the previous call must stay, marked with when it was last confirmed');
  assert.deepEqual(reduce({ ...call, staleSince: 500 }, 1000), { result: { call: 'BUY' }, loading: false, error: false, staleSince: 500 }, 'a second failure must keep the ORIGINAL confirmation time');
  assert.deepEqual(reduce({ result: null, loading: false, error: false }, 1000), { result: null, loading: false, error: true }, 'never a call: the error state');
  assert.deepEqual(reduce({ result: null, loading: true, error: false }, 1000), { result: null, loading: false, error: true }, 'still loading the first call: the error state');
  assert.equal('staleSince' in reduce({ result: null, loading: false, error: false }, 1000), false, 'the error state carries no age');
  assert.equal(reduce({ ...call, error: true }, 7).error, false, 'a kept call is not an error');
});
test('T2. EMA hook: a failure keeps a good signal with its age; a loading, errored or LOADING-verdict signal becomes the unavailable state', () => {
  const body = must(ema, /setSig\(prev => (\(!prev\.loading && !prev\.error && prev\.verdict !== 'LOADING' \? [\s\S]+?\}\))\);/, 'EMA failure reducer');
  const LOADING = { verdict: 'LOADING', loading: true, error: null }; const reduce = (prev: Record<string, unknown>) => ev(`((prev) => ${body})`, { STRATEGY_LOADING: LOADING, err: new Error('boom'), lastGoodAtRef: { current: 4242 } })(prev) as Record<string, unknown>;
  const good = { verdict: 'BULLISH', loading: false, error: null, levels: [1, 2] };
  assert.deepEqual(reduce(good), { ...good, staleSince: 4242 }, 'a good signal must stay, marked with the last confirmation'); assert.equal(reduce(good).error, null, 'a kept signal is not an error');
  assert.deepEqual(reduce({ ...good, staleSince: 100 }), { ...good, staleSince: 100 }, 'a repeated failure keeps the ORIGINAL time');
  for (const prev of [LOADING, { ...good, loading: true }, { ...good, error: 'X' }, { ...good, verdict: 'LOADING' }]) { const r = reduce(prev); assert.equal(r.loading, false); assert.match(String(r.error), /boom/, `${JSON.stringify(prev)}: must be the unavailable state`); assert.equal('staleSince' in r, false); }
  assert.match(ema, /useEffect\(\(\) => \{ if \(!sig\.loading && !sig\.error && sig\.staleSince == null\) lastGoodAtRef\.current = Date\.now\(\); \}, \[sig\]\);/, 'the last-confirmed time stops following the signal once it is stale (or it would read "just now" forever)');
});
test('T3. the retry: 45 s after a failure; the old candle-close wait (floored at 5 s) after a success', () => {
  const expr = must(strat, /timer = setTimeout\(run, (failed \? 45_000 : Math\.max\(5_000, msUntilNextClose\(tfMs, Date\.now\(\)\) \+ 2_000\))\);/, 'strategy retry delay');
  for (const [failed, until] of [[true, 900_000], [true, 86_400_000], [true, 0], [false, 900_000], [false, 14_400_000], [false, 1_000], [false, 0]] as const) { const got = ev(expr, { failed, tfMs: 1, msUntilNextClose: () => until, Date }) as number; const want = failed ? 45_000 : Math.max(5_000, until + 2_000); assert.equal(got, want, `failed=${failed} until=${until}`); }
  assert.equal(ev(expr, { failed: true, tfMs: 1, msUntilNextClose: () => 86_400_000, Date }), 45_000, 'a failed 1D read must not wait a day');
});
test('T4. only a failure sets the mark: successes, "too few candles", coin/timeframe changes build fresh objects without it', () => {
  for (const m of strat.matchAll(/setState\(\{ result: [^;]*?\}\);/g)) assert.equal(/staleSince/.test(m[0]), false, `a success/other state carries the mark: ${m[0].slice(0, 90)}`);
  assert.match(strat, /setState\(\{ result: first, loading: false, error: false,/); assert.match(strat, /setState\(\{ result: null, loading: true, error: false \}\);/);
  const ok = ema.slice(ema.indexOf('setSig({', ema.indexOf('async')), ema.indexOf('setSig({') + 1500); assert.equal(/staleSince/.test(ok.split('catch')[0].slice(0, 1400)), false, 'the EMA success state must not carry the mark');
  assert.match(ema, /setSig\(STRATEGY_LOADING\);/, 'a coin/timeframe change resets to LOADING (which has no mark)'); assert.equal(/staleSince/.test(ema.slice(ema.indexOf('STRATEGY_LOADING', ema.indexOf('const STRATEGY_LOADING')), ema.indexOf('STRATEGY_LOADING', ema.indexOf('const STRATEGY_LOADING')) + 400)), false);
});
test('T5. the age text is identical in both cards: just now under 60 s, N min ago under an hour, else N h ago; a negative age reads 0', () => {
  const grab = (s: string) => must(s, /const (?:freshness|age) = (secs < 60 \? t\('ARENA_FRESHNESS_JUST_NOW'\) : secs < 3600 \? t\('ARENA_FRESHNESS_MINUTES_AGO', \{ n: Math\.floor\(secs \/ 60\) \}\) : t\('ARENA_FRESHNESS_HOURS_AGO', \{ n: Math\.floor\(secs \/ 3600\) \}\));/, 'age expression');
  const a = grab(emaCard), b = grab(callBox); assert.equal(a, b, 'the two cards compute the age differently');
  const t = (k: string, v?: { n: number }) => (v ? `${k}:${v.n}` : k);
  for (const [secs, want] of [[0, 'ARENA_FRESHNESS_JUST_NOW'], [59, 'ARENA_FRESHNESS_JUST_NOW'], [60, 'ARENA_FRESHNESS_MINUTES_AGO:1'], [125, 'ARENA_FRESHNESS_MINUTES_AGO:2'], [3599, 'ARENA_FRESHNESS_MINUTES_AGO:59'], [3600, 'ARENA_FRESHNESS_HOURS_AGO:1'], [7300, 'ARENA_FRESHNESS_HOURS_AGO:2'], [90_000, 'ARENA_FRESHNESS_HOURS_AGO:25']] as const) assert.equal(ev(a, { secs, t }), want, `${secs} s`);
  for (const s of [emaCard, callBox]) assert.match(s, /const secs = Math\.max\(0, Math\.floor\(\(Date\.now\(\) - (?:signal|state)\.staleSince\) \/ 1000\)\);/, 'the age must be clamped at 0 (clock skew)');
  const defaults = JSON.parse(src('lib/labelDefaults.en.json')) as Record<string, string>; for (const k of ['ARENA_FRESHNESS_JUST_NOW', 'ARENA_FRESHNESS_MINUTES_AGO', 'ARENA_FRESHNESS_HOURS_AGO', 'ARENA_UPDATED_FRESHNESS']) assert.ok(defaults[k], `${k} has no default`); assert.match(defaults.ARENA_UPDATED_FRESHNESS, /\{freshness\}/);
});
test('T6. the render gates: the EMA card shows the age only for a kept (non-error) signal; the call box shows it whenever a kept call is marked', () => {
  assert.match(emaCard, /\{signal\.staleSince != null && !signal\.error && \(\(\) => \{/); assert.match(callBox, /\{state\.staleSince != null && \(\(\) => \{/);
  assert.match(emaCard, /data-testid="ema-signal-stale"/); assert.match(callBox, /data-testid="strategy-call-stale"/);
});
