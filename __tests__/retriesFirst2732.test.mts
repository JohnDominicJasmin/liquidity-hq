import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2732 (failing-text sweep 2, PM option A, 2026-11-20): "RETRIES FIRST, THE WORD ONLY AFTER THEM", in three places. WRITTEN RULES (from the PR / PM, not from the code):
 *   (1) useStrategySignal (the strategy call): a FAILED candle read from load shows the LOADING skeleton first; the `strategy-call-unavailable` state appears only after the SECOND failed read in a row (the retry is 45 s after the first, so about 50 s from load); a call already on screen is kept whatever the counter says.
 *   (2) the scanner feed (components/MarketProvider.tsx): `failed` is set only after the two capped retries (30 s, then 60 s): the cells keep their loading ellipsis for about 90 s and say the word after that.
 *   (3) useOI1h: a first failed read keeps loading; a later failed poll keeps the last good figures; failure shows only after two in a row with nothing to keep.
 * The REAL statements are cut out of the sources (lib/useStrategySignal.ts, components/MarketProvider.tsx, lib/useOI1h.ts) and driven through the sequences the rules describe, with stand-ins only for React state, timers and the network.
 *   R1 strategy: the counter is declared per effect, reset by an answered read, bumped by a failed one   R2 strategy: first failure = skeleton, second = error, a good call is kept, a blip then success never shows the error
 *   S1 scanner bulk-read branch: `failed` only at the third failed pass, after retries of 30 s and 60 s   S2 scanner Binance-only branch: same gate; an answered read says ok and resets the retries   S3 the cap: no fourth try
 *   O1 useOI1h: skeleton on the first failure, failure on the second   O2 a last good figure survives any number of failed polls and is replaced by a newer good one   O3 a short window is not a failure   O4 a thrown request is a failed read   O5 a coin change resets both counters
 * NOT covered (needs a browser and a 90 s wait): the Arena strategy box and the scanner cells on the real page (qa/e2e/strategy-menu.spec.ts M3u, qa/e2e/scanner-cells.spec.ts K1+K2+K4 / K3b, qa/e2e/funding-chip-fallback.spec.ts F2). */
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const strat = src('lib/useStrategySignal.ts'), mp = src('components/MarketProvider.tsx'), oi = src('lib/useOI1h.ts');
const must = (s: string, re: RegExp, what: string): RegExpExecArray => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m!; };
const at = (s: string, needle: string, what: string, from = 0): number => { const i = s.indexOf(needle, from); assert.ok(i >= 0, `CONTROL: ${what} not found`); return i; };
const AsyncFunction = Object.getPrototypeOf(async function () { /* constructor holder */ }).constructor as new (...a: string[]) => (...args: unknown[]) => Promise<unknown>;

type St = Record<string, unknown>;
const stateBox = (initial: St) => { const box = { state: initial, history: [] as St[] }; const set = (a: St | ((p: St) => St)) => { box.state = typeof a === 'function' ? a(box.state) : a; box.history.push(box.state); }; return { box, set }; };

/* ---------------------------------------------------------------- (1) useStrategySignal */
const effectAt = at(strat, 'useEffect(() => {', 'the hook effect');
const declAt = must(strat, /\n\s*let fails = 0;/, 'the per-effect counter `let fails = 0;`').index;
const runAt = at(strat, 'const run = async () => {', 'the run function');
const catchAt = at(strat, '} catch {', 'the catch of the read'), failedAt = at(strat, 'failed = true;', 'the failed flag', catchAt);
const catchBody = strat.slice(catchAt + '} catch {'.length, failedAt);
const resetM = must(strat, /\n\s*(fails = 0;)\n/, 'the reset `fails = 0;` on an answered read');
const readAt = at(strat, 'Promise.all([', 'the candle reads', runAt);

function strategyHarness() {
  const { box, set } = stateBox({ result: null, loading: true, error: false });
  /* the catch text is the real statement list; `fails` lives in a closure shared by every call, like the effect's `let fails = 0` shared by the 45 s retries */
  const make = new Function('setState', 'cancelled', 'lastOkAt', `let fails = 0; return { fail: () => { ${catchBody} }, answered: () => { ${resetM[1]} }, count: () => fails };`) as (s: typeof set, c: boolean, l: number) => { fail: () => void; answered: () => void; count: () => number };
  const h = make(set, false, 1000);
  return { box, h, good: () => { h.answered(); set({ result: { call: 'BUY' }, loading: false, error: false }); } };
}

test('R1. the counter is declared INSIDE the effect (a coin / timeframe / strategy change starts at 0), reset by an answered read, bumped before the state is set', () => {
  assert.ok(effectAt < declAt && declAt < runAt, '`let fails = 0` must sit between the effect start and `const run` (per effect, shared by the retries); at module or hook level a coin change would carry the old count');
  assert.ok(readAt < resetM.index && resetM.index < catchAt, 'the reset must follow the candle reads and sit in the try, before the catch');
  assert.ok(catchBody.indexOf('fails += 1;') >= 0 && catchBody.indexOf('fails += 1;') < catchBody.indexOf('setState('), 'the counter must be bumped BEFORE the state reads it');
  assert.match(strat, /timer = setTimeout\(run, failed \? 45_000 :/, 'the retry after a failed read is 45 s (the second read, so the word at about 50 s)');
  assert.match(strat.slice(runAt + 1, runAt + 200), /let failed = false;/, 'CONTROL: `failed` is the per-run flag');
});

test('R2. FIRST failed read with no call: the loading skeleton; SECOND in a row: the unavailable state; a call on screen is kept at any count; a blip then success never shows the error', () => {
  const a = strategyHarness();
  a.h.fail(); assert.deepEqual(a.box.state, { result: null, loading: true, error: false }, 'the first failed read must keep the LOADING skeleton, not the unavailable state');
  a.h.fail(); assert.deepEqual(a.box.state, { result: null, loading: false, error: true }, 'the second failed read in a row (failKlines all) must end in the unavailable state, later');
  a.h.fail(); assert.deepEqual(a.box.state, { result: null, loading: false, error: true }, 'it stays unavailable while every read keeps failing');
  const b = strategyHarness();
  b.h.fail(); b.good(); assert.equal(b.h.count(), 0, 'an answered read resets the count');
  assert.ok(b.box.history.every(s => s.error !== true), 'one failed read then success: the unavailable state must never have shown');
  b.h.fail(); assert.deepEqual(b.box.state, { result: { call: 'BUY' }, loading: false, error: false, staleSince: 1000 }, 'a failed refresh after a good call keeps that call with its age (#2678), at fails=1');
  b.h.fail(); b.h.fail(); assert.deepEqual(b.box.state, { result: { call: 'BUY' }, loading: false, error: false, staleSince: 1000 }, 'and at fails=3 (the call is never replaced by the error)');
  /* fail, answered, fail, answered...: the count must restart at the next failure (a reset that did not happen would show the error on the second of two NON-consecutive failures) */
  const c = strategyHarness();
  c.h.fail(); c.h.answered(); c.box.state = { result: null, loading: true, error: false }; c.h.fail();
  assert.deepEqual(c.box.state, { result: null, loading: true, error: false }, 'two failures that are NOT in a row must not show the unavailable state');
});

/* ---------------------------------------------------------------- (2) the scanner feed */
const bulkOpen = "if (!d || !Array.isArray(d.result?.list)) {";
const bulkAt = at(mp, bulkOpen, 'the failed-bulk-read branch'), bulkEnd = at(mp, 'return;', 'the branch return', bulkAt);
const bulkBody = mp.slice(bulkAt + bulkOpen.length, bulkEnd + 'return;'.length);
const bnFrom = at(mp, "if (bnAnswered) setScannerFeed({ binanceOnly: 'ok' });", 'the Binance-only outcome lines');
const bnTo = at(mp, 'setTimeout(() => { fetchPriceBackup(); }, 6000);', 'the backup timer after the outcome lines', bnFrom);
const bnBody = mp.slice(bnFrom, bnTo);

type Feed = Record<string, string>;
function scannerWorld() {
  const feed: Feed[] = []; const ref = { current: 0 }; const timer: { current: { ms: number; fn: () => void } | null } = { current: null };
  const timers: number[] = []; let refetch = 0;
  const fakeSetTimeout = (fn: () => void, ms: number) => { timers.push(ms); return { ms, fn }; };
  const setScannerFeed = (p: Feed) => { feed.push(p); };
  const bulk = new AsyncFunction('scannerRetryRef', 'scannerRetryTimer', 'setScannerFeed', 'setTimeout', 'fetchBybit', 'fetchPriceBackup', 'fundingFromBinance', bulkBody);
  const bn = new Function('bnAnswered', 'scannerRetryRef', 'scannerRetryTimer', 'setScannerFeed', 'setTimeout', 'fetchBybit', bnBody) as (...a: unknown[]) => void;
  const fetchBybit = () => { refetch += 1; };
  /* one failed pass of the bulk read, then (like the real timer) fire the retry it scheduled and report how long it waited */
  const passBulk = async () => { const before = feed.length; await bulk(ref, timer, setScannerFeed, fakeSetTimeout, fetchBybit, () => undefined, async () => undefined); return { set: feed.slice(before), wait: waitAndFire() }; };
  const passBn = (answered: boolean) => { const before = feed.length; bn(answered, ref, timer, setScannerFeed, fakeSetTimeout, fetchBybit); return { set: feed.slice(before), wait: waitAndFire() }; };
  const waitAndFire = () => { const t = timer.current; if (!t) return 0; const ms = t.ms; t.fn(); return ms; };
  return { feed, ref, timer, timers, passBulk, passBn, refetches: () => refetch };
}

test('S1. every Bybit bulk read fails: the first two passes say nothing and wait 30 s then 60 s; `failed` is set only on the THIRD pass (about 90 s), for both feeds', async () => {
  const w = scannerWorld(); let elapsed = 0; const log: string[] = [];
  for (let pass = 1; pass <= 3; pass++) { const r = await w.passBulk(); elapsed += r.wait; log.push(`pass ${pass}: set=${JSON.stringify(r.set)} wait=${r.wait}`);
    if (pass < 3) { assert.deepEqual(r.set, [], `pass ${pass}: the feed must stay pending (the loading ellipsis), nothing is said yet. ${log.join(' | ')}`); assert.equal(r.wait, pass === 1 ? 30_000 : 60_000, `pass ${pass}: the retry delay is 30 s then 60 s`); }
    else { assert.deepEqual(r.set, [{ universe: 'failed', binanceOnly: 'failed' }], `pass 3: the word is set now. ${log.join(' | ')}`); assert.equal(r.wait, 0, 'no third retry is scheduled'); } }
  assert.equal(elapsed, 90_000, 'the loading ellipsis lasts about 90 s (30 s + 60 s) before the word');
  assert.equal(w.refetches(), 2, 'two retries ran, no more');
  assert.equal(w.timers.filter(ms => ms === 6000).length, 3, 'the price-backup read still follows every failed pass (unchanged)');
});

test('S2. Binance-only reads: refused passes keep the ellipsis until the retries are used, then say failed; an answered read says ok and resets the retries', () => {
  const w = scannerWorld();
  const p1 = w.passBn(false); assert.deepEqual(p1.set, [], 'first refused pass: nothing is said'); assert.equal(p1.wait, 30_000);
  const p2 = w.passBn(false); assert.deepEqual(p2.set, [], 'second refused pass: still nothing'); assert.equal(p2.wait, 60_000);
  const p3 = w.passBn(false); assert.deepEqual(p3.set, [{ binanceOnly: 'failed' }], 'third refused pass: the word, after the retries are used'); assert.equal(p3.wait, 0);
  const ok = w.passBn(true); assert.deepEqual(ok.set, [{ binanceOnly: 'ok' }], 'an answered read says ok'); assert.equal(w.ref.current, 0, 'an answered read resets the retry count');
  const w2 = scannerWorld(); w2.passBn(false); const answered = w2.passBn(true);
  assert.deepEqual(answered.set, [{ binanceOnly: 'ok' }], 'one refused pass then an answer: ok, and the word was never said'); assert.ok(w2.feed.every(f => f.binanceOnly !== 'failed'), 'a single blip must never show the word');
});

test('S3. the cap and the timings are the written ones: at most two retries, 30 s x retry number; the gate and the cap read the same constant 2', () => {
  assert.equal([...bulkBody.matchAll(/scannerRetryRef\.current >= 2/g)].length, 1, 'the bulk branch gates the word on two used retries');
  assert.equal([...bulkBody.matchAll(/scannerRetryRef\.current < 2/g)].length, 1, 'the bulk branch caps the retries at two');
  assert.match(bnBody, /else if \(scannerRetryRef\.current >= 2\) setScannerFeed\(\{ binanceOnly: 'failed' \}\)/, 'the Binance-only branch gates the word on two used retries');
  assert.equal([...(bulkBody + bnBody).matchAll(/30_000 \* scannerRetryRef\.current/g)].length, 2, 'both retry timers are 30 s x the retry number (30 s, then 60 s)');
  const w = scannerWorld(); return w.passBulk().then(async () => { await w.passBulk(); await w.passBulk(); const r4 = await w.passBulk(); assert.equal(r4.wait, 0, 'a fourth failed pass schedules no retry (the 8-minute poll is the only one left)'); assert.equal(w.refetches(), 2); });
});

/* ---------------------------------------------------------------- (3) useOI1h */
const oiEffectAt = at(oi, 'useEffect(() => {', 'the hook effect');
const onFailedM = must(oi, /const onFailedRead = \(\) => \{\n([\s\S]*?)\n    \};\n/, 'onFailedRead');
const onFailedAt = onFailedM.index;
const postFrom = at(oi, "if (mountedRef.current) {\n          if (result.reason === 'failed') onFailedRead();", 'the post-read outcome block');
const postTo = at(oi, '\n      } catch {', 'the catch after it', postFrom);
const postBlock = oi.slice(postFrom, postTo);
const thrownM = must(oi, /\} catch \{\n\s*(if \(mountedRef\.current\) onFailedRead\(\);)\n\s*\} finally/, 'the catch that reports a thrown read');
const resetIdx = { fails: oi.search(/\n\s*failsRef\.current\s*=\s*0;/), good: oi.search(/\n\s*lastGoodRef\.current\s*=\s*null;/) };

type OI = { coin: string; oiUsd: number | null; pct: number | null; pricePct: number | null; loading: boolean; reason: string };
const initial: OI = { coin: 'btc', oiUsd: null, pct: null, pricePct: null, loading: true, reason: 'failed' };
function oiWorld() {
  const box = { state: initial as St, history: [] as St[] }; const setData = (a: St | ((p: St) => St)) => { box.state = typeof a === 'function' ? a(box.state) : a; box.history.push(box.state); };
  const failsRef = { current: 0 }, lastGoodRef: { current: unknown } = { current: null }, mountedRef = { current: true };
  const make = new Function('setData', 'mountedRef', 'failsRef', 'lastGoodRef', `const onFailedRead = () => {\n${onFailedM[1]}\n};\nreturn { read: (result) => { ${postBlock} }, thrown: () => { ${thrownM[1]} } };`) as (...a: unknown[]) => { read: (r: St) => void; thrown: () => void };
  const h = make(setData, mountedRef, failsRef, lastGoodRef);
  const okRes = (pct: number) => ({ coin: 'btc', oiUsd: 5e9, pct, pricePct: 0.4, reason: 'ok' });
  const failedRes = { coin: 'btc', oiUsd: null, pct: null, pricePct: null, reason: 'failed' };
  return { box, h, failsRef, lastGoodRef, okRes, failedRes };
}

test('O1. no figure yet: the FIRST failed read keeps the loading state, the SECOND in a row reports the failure (nulls, reason failed, not loading)', () => {
  const w = oiWorld();
  w.h.read(w.failedRes); assert.equal(w.box.state.loading, true, 'first failed read: still loading'); assert.equal(w.box.state.pct, null);
  w.h.read(w.failedRes); assert.equal(w.box.state.loading, false, 'second failed read in a row, nothing to keep: loading ends'); assert.equal(w.box.state.pct, null); assert.equal(w.box.state.reason, 'failed', 'and the reason says it failed');
  const b = oiWorld(); b.h.read(b.failedRes); b.h.read(b.okRes(1.5)); assert.equal(b.box.state.pct, 1.5, 'one blip then an answer: the figure shows'); assert.ok(b.box.history.every(s => !(s.loading === false && s.reason === 'failed')), 'a single blip must never show the failure');
});

test('O2. a failed poll after a good read KEEPS the last good figures (any number of times) and a newer good read replaces them', () => {
  const w = oiWorld(); w.h.read(w.okRes(2.5));
  for (let i = 1; i <= 4; i++) { w.h.read(w.failedRes); assert.deepEqual(w.box.state, { coin: 'btc', oiUsd: 5e9, pct: 2.5, pricePct: 0.4, reason: 'ok', loading: false }, `failed poll ${i}: the last good figures stay, never nulls and never reason failed`); }
  w.h.read(w.okRes(-0.7)); w.h.read(w.failedRes); assert.equal(w.box.state.pct, -0.7, 'the NEWER good figure is the one kept');
  assert.equal(w.failsRef.current, 1, 'the count restarted at the good read');
});

test('O3. a short window is an answer, not a failure: it shows as before, resets the count, and is not kept as a "last good" figure', () => {
  const w = oiWorld(); const sw = { coin: 'btc', oiUsd: null, pct: null, pricePct: null, reason: 'short-window' };
  w.h.read(w.failedRes); w.h.read(sw); assert.deepEqual(w.box.state, { ...sw, loading: false }, 'a short-window answer is shown as itself'); assert.equal(w.failsRef.current, 0);
  assert.equal(w.lastGoodRef.current, null, 'a short window is not a good figure to keep');
  w.h.read(w.failedRes); assert.equal(w.box.state.loading, true, 'the next failed read after an answer is a FIRST one again: loading');
});

test('O4. a thrown request is a failed read, the same as an answered "failed"', () => {
  const w = oiWorld(); w.h.thrown(); assert.equal(w.box.state.loading, true, 'a first thrown read keeps loading'); w.h.thrown(); assert.equal(w.box.state.loading, false, 'a second ends it');
  const g = oiWorld(); g.h.read(g.okRes(3)); g.h.thrown(); assert.equal(g.box.state.pct, 3, 'a thrown poll after a good read keeps the figure');
  assert.ok(postBlock.includes("if (result.reason === 'failed') onFailedRead();"), 'CONTROL: the answered-failed path goes through the same handler');
});

test('O5. a coin change starts clean: the effect resets BOTH counters before the first read (a last good figure of the previous coin must never show for the next one)', () => {
  assert.ok(oiEffectAt < resetIdx.fails && resetIdx.fails < onFailedAt, 'failsRef is reset inside the effect, before the handler');
  assert.ok(oiEffectAt < resetIdx.good && resetIdx.good < onFailedAt, 'lastGoodRef is cleared inside the effect, before the handler');
  assert.match(oi, /failsRef\.current\s*=\s*0;\s*\n\s*lastGoodRef\.current\s*=\s*null;\s*\n\s*setData\(\{ coin, oiUsd: null/, 'both resets sit right before the loading state is set for the new coin');
  assert.match(oi, /const lastGoodRef\s*=\s*useRef<Omit<OI1hData, 'loading'> \| null>\(null\);/, 'CONTROL: lastGoodRef holds the figures without the loading flag');
  assert.match(postBlock, /if \(result\.reason === 'ok'\) lastGoodRef\.current = result;/, 'only an ok figure is kept');
});
