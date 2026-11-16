/* #2471: three page-load fixes from the prod read.
 *   H1  the sign-in security-check hint (CaptchaStuckHint): the failure rule (SLICED and run over its full truth table): red only when waiting AND (the widget reported an error OR 6 s passed with no widget iframe); a visible widget that is simply waiting gets no red text; not waiting -> never
 *   H2  the hint is wired on all three forms: each passes the id of ITS OWN widget container (the id the Turnstile is rendered with), and the widget's onError sets the error flag, onSuccess clears it
 *   H3  /correlation: withDeadline (SLICED and run under a mocked clock): a rejected read gives the fallback at once, a slow read gives the fallback at the deadline, a fast read wins; the constants are 8 s per request and 10 s per coin; no Promise.all over the coins gates the page; a coin still loading reads "…" and one with no data reads "-"
 *   H4  /funding: the table is no longer gated on the full history (no `!loading &&` before the table), the Binance batch is shown (setHistory(first) before setLoading(false)), each Bybit fallback coin is added as it arrives by merging into the previous history, and the batch has a 10 s deadline that falls back to {} (never a hang)
 * WHAT IT CANNOT PROVE: real LCP / first paint (3.5 s cold funding, ~10 s correlation on a phone): the measurement cells in the group run, nor the widget in a real blocked-script case. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hint = read('components/CaptchaStuckHint.tsx'), corr = read('components/CorrelationTerminal.tsx'), fund = read('components/FundingTerminal.tsx');
const tick = () => new Promise<void>((r) => setImmediate(r));

test('H1. the failure rule over its full truth table (sliced from the component)', () => {
  const m = hint.match(/const failed = ([^;]+);/); assert.ok(m, 'CONTROL: the failed expression was not found');
  /* the expression is OUR OWN checked-in source, never input */
  const failed = new Function('waiting', 'errored', 'over', 'hasFrame', `return ${m![1]};`) as (w: boolean, e: boolean, o: boolean, f: boolean) => boolean;
  for (const waiting of [true, false]) for (const errored of [true, false]) for (const over of [true, false]) for (const hasFrame of [true, false]) {
    const want = waiting && (errored || (over && !hasFrame)); assert.equal(failed(waiting, errored, over, hasFrame), want, `waiting=${waiting} errored=${errored} over=${over} hasFrame=${hasFrame}`);
  }
  assert.equal(failed(true, false, true, true), false, 'a visible widget that is simply waiting must get no red text'); assert.equal(failed(true, false, false, false), false, 'not yet 6 s and no error: no red text'); assert.equal(failed(true, true, false, true), true, 'a reported widget error must show at once');
  assert.ok(hint.includes("data-testid=\"captcha-stuck-hint\"") && hint.includes("display: failed ? undefined : 'none'") && hint.includes('useGraceElapsed(6_000)'), 'the hint lost its testid / hidden-when-fine / 6 s');
  assert.ok(hint.includes('return () => clearInterval(id);'), 'the frame poll leaks its interval');
});
test('H2. each form passes the id of its own widget and wires onError / onSuccess to the flag', () => {
  for (const [file, ids] of [['app/(main)/login/page.tsx', ['cf-turnstile-magiclink', 'cf-turnstile-password']], ['app/(main)/forgot-password/page.tsx', ['cf-turnstile-forgot-password']]] as const) {
    const s = read(file);
    for (const id of ids) { assert.ok(s.includes(`widgetId="${id}"`), `${file}: the hint does not name ${id}`); assert.ok((s.match(new RegExp(`${id}`, 'g')) ?? []).length >= 2, `${file}: ${id} is only the hint's argument, no widget is rendered with that id`); }
    assert.ok(/onError=\{\(\) => \{[^}]*set\w*CaptchaErr\(true\)/.test(s), `${file}: a widget error does not set the flag`); assert.ok(/onSuccess=\{t => \{ set\w*CaptchaErr\(false\)/.test(s), `${file}: success does not clear the flag`);
  }
});

const a = corr.indexOf('const withDeadline = '); assert.ok(a > 0, 'CONTROL: withDeadline not found'); const b = corr.indexOf('\n', corr.indexOf('Promise.race', a));
/* the slice is OUR OWN checked-in source, never input */
const withDeadline = new Function(`${stripTypeScriptTypes(corr.slice(a, b).replace('<T,>', '<T>'))}\nreturn withDeadline;`)() as <T>(p: Promise<T>, ms: number, fallback: T) => Promise<T>;

test('H3. /correlation withDeadline: rejection -> fallback at once, slow -> fallback at the deadline, fast -> the value; constants; no page-wide gate; cell text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(await withDeadline(Promise.reject(new Error('x')), 10_000, [] as number[]), [], 'a failed read did not give the fallback at once');
  assert.deepEqual(await withDeadline(Promise.resolve([1, 2]), 10_000, [] as number[]), [1, 2], 'a fast read lost to the fallback');
  let got: number[] | null = null; const slow = new Promise<number[]>(() => {}); void withDeadline(slow, 10_000, [] as number[]).then((v) => { got = v; });
  t.mock.timers.tick(9_999); await tick(); assert.equal(got, null, 'fallback before the deadline'); t.mock.timers.tick(2); await tick(); assert.deepEqual(got, [], 'a hung read never gave up');
  assert.ok(corr.includes('const FETCH_DEADLINE_MS = 8_000;') && corr.includes('const COIN_DEADLINE_MS = 10_000;'), 'the deadlines changed');
  assert.ok(corr.includes('{ signal: deadlineSignal(FETCH_DEADLINE_MS) }') && corr.includes('attemptTimeoutMs: FETCH_DEADLINE_MS'), 'a per-request deadline is gone from the Binance or Bybit read');
  assert.equal(/await Promise\.all\(COINS\.map/.test(corr), false, 'a Promise.all over every coin gates the page again');
  assert.ok(corr.includes("const loading = done.size < COINS.length;") && corr.includes('setDone(prev => new Set(prev).add(id));'), 'each coin no longer settles on its own');
  assert.ok(corr.includes("r !== null ? r.toFixed(2) : (!done.has(a) || !done.has(b)) ? '…' : '-'"), 'a loading cell and a no-data cell no longer read differently');
  assert.ok(corr.includes('setRets({});') && corr.includes('setDone(new Set());'), 'switching range keeps the previous range\'s returns or done set');
});
test('H4. /funding paints from the snapshot: no table-wide gate; batch shown first; Bybit fallbacks merge in; the batch deadline falls back to {}', () => {
  assert.equal(/\{!loading && \(\(\) =>/.test(fund), false, 'the table is gated on the history fetch again'); assert.ok(fund.includes('{(() => {'), 'CONTROL: the ungated table IIFE was not found');
  assert.ok(fund.indexOf('setHistory(first);') > 0 && fund.indexOf('setHistory(first);') < fund.indexOf('setLoading(false);'), 'the batch is not shown before loading clears');
  assert.ok(fund.includes('setHistory(prev => ({ ...prev, [id]: pts }));'), 'a Bybit fallback replaces the history instead of merging into it'); assert.ok(fund.includes('if (!cancelled && pts.length)'), 'a late fallback writes after unmount or with no data');
  assert.ok(fund.includes("fetch('/api/market/funding-rate?limit=42', { signal: deadlineSignal(10_000) })"), 'the batch has no 10 s deadline'); assert.ok(/catch \{ return \{\}; \}/.test(fund), 'a failed batch does not fall back to {} (the page would wait for ever)');
});
