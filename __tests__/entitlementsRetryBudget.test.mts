/* #1173: retryWithBackoff gains an optional overallBudgetMs, and AuthProvider's entitlements fetch is the
 * first (only) caller to set one - entitlements was 15s x 3 attempts + [1000,2000] backoff = ~48s worst case
 * against a dead /rest/v1, the biggest number in the auth path. SettingsProvider's own call is untouched
 * (omits overallBudgetMs), so its timing must be identical by construction - not asserted here again since
 * __tests__/retryWithBackoff.test.mts (#1199) already pins that behavior and this commit doesn't touch it;
 * confirmed by re-running that file's 7 tests unmodified against 15cea883 before writing this one (all pass).
 *
 * lib/retryWithBackoff.ts is a real, DOM-free module - unlike most files tonight, this is a genuine behavioral
 * unit test of the imported function itself, not a source-grep structure check. Uses node:test's built-in
 * `t.mock.timers` (confirmed working in this exact test-runner setup via a throwaway probe before writing this
 * file) so backoff/timeout waits are simulated, not really slept - a single large tick() does NOT cascade
 * through a chain of sequential awaited setTimeouts (confirmed by a probe that hung and had to be killed), so
 * every multi-step scenario below advances the clock in the same per-segment tick()+flush sequence
 * __tests__/retryWithBackoff.test.mts already established, never one big tick.
 *
 * AuthProvider.tsx's own wiring (ENTITLEMENTS_OVERALL_BUDGET_MS, the AbortSignal's min() computation) is a
 * React component, so that part is the usual structure/source check, at the bottom of this file. The
 * settle-to-'unknown' behavior on exhaustion is #1119, unchanged by this commit and already covered elsewhere
 * (qa/e2e/entitlement-unknown.spec.ts per #1199's own test file) - not re-asserted here, only the NEW timing
 * wiring this commit actually added.
 *
 * { timeout: 5000 } on every subtest that drives a FIXED tick() sequence (not just a mutation-testing nicety -
 * found the hard way, mutation-checking this file): a mutation that changes which branch the code takes
 * (skip vs. wait, or how long an inner sleep runs) can desync the test's hard-coded tick budget from what the
 * mutated code actually awaits, so `await p` blocks on a mocked setTimeout that never gets ticked far enough -
 * a genuine hang, not a clean red, that took a killed background process to diagnose. The timeout turns that
 * into a fast, clear failure instead of one that would sit there under a real future regression too. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retryWithBackoff } from '../lib/retryWithBackoff.ts';

type Res = { failed: boolean; tag?: string };

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

test('retryWithBackoff overallBudgetMs (#1173)', async (t) => {
  await t.test('omitting overallBudgetMs (SettingsProvider\'s case): remainingBudgetMs passed to every attempt is Infinity', async () => {
    const seen: number[] = [];
    const attempt = async (n: number, remaining: number) => { seen.push(remaining); return n < 3 ? { failed: true } as Res : { failed: false } as Res; };
    // maxAttempts=1 so there's no backoff wait to simulate - Infinity-when-omitted is the only thing this
    // test cares about, kept separate from the multi-attempt/timer scenarios below.
    await retryWithBackoff(attempt, { maxAttempts: 1, backoffMs: [] });
    assert.deepEqual(seen, [Infinity]);
  });

  await t.test('attempt 1 always runs even when overallBudgetMs is already 0 - there is always a result to return', async () => {
    const calls: Array<{ n: number; remaining: number }> = [];
    const attempt = async (n: number, remaining: number) => { calls.push({ n, remaining }); return { failed: true, tag: `try-${n}` } as Res; };
    const out = await retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000], overallBudgetMs: 0 });
    assert.deepEqual(calls, [{ n: 1, remaining: 0 }], 'attempt 2 must never be called when the budget was already spent before attempt 1');
    assert.equal(out.attempts, 1);
    assert.equal(out.cancelled, false);
    assert.equal(out.result.tag, 'try-1');
  });

  await t.test('each attempt receives the ACTUAL remaining budget, decreasing by real elapsed backoff time - not a static value', { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const seen: number[] = [];
    const attempt = async (n: number, remaining: number) => { seen.push(remaining); return { failed: true } as Res; };
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 500], overallBudgetMs: 5000 });
    await flushMicrotasks();
    assert.deepEqual(seen, [5000], 'attempt 1 sees the full budget, no time has elapsed yet');
    t.mock.timers.tick(1000); await flushMicrotasks();
    assert.deepEqual(seen, [5000, 4000], 'attempt 2 sees the budget minus the 1000ms backoff that was actually waited');
    t.mock.timers.tick(500); await flushMicrotasks();
    assert.deepEqual(seen, [5000, 4000, 3500], 'attempt 3 sees the budget minus BOTH backoffs');
    const out = await p;
    assert.equal(out.attempts, 3);
  });

  await t.test('stops before starting the next attempt when the remaining budget would not even cover the next backoff - returns immediately, no wait scheduled', async () => {
    const calls: number[] = [];
    const attempt = async (n: number) => { calls.push(n); return { failed: true } as Res; };
    const t0 = Date.now();
    const out = await retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000], overallBudgetMs: 500 });
    const elapsedRealMs = Date.now() - t0;
    assert.deepEqual(calls, [1], 'attempt 2 never fires: remaining (500) <= backoffMs[0] (1000), so the wait itself is skipped rather than run short');
    assert.equal(out.attempts, 1);
    assert.equal(out.cancelled, false);
    assert.ok(elapsedRealMs < 200, `returned in ${elapsedRealMs}ms - it must return immediately, not actually wait out any part of the skipped backoff`);
  });

  await t.test('FLAGSHIP - real entitlements numbers: a dead server (always-failing, AbortSignal-bounded attempt) is capped at the budget (~22000ms, 2 attempts), not maxAttempts x per-attempt-bound (~48000ms, 3 attempts) - the whole point of #1173', { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const t0 = Date.now();
    const ENTITLEMENTS_FETCH_MS = 15000;
    const calls: Array<{ n: number; remaining: number; startedAt: number }> = [];
    // Mirrors AuthProvider's real shape: the attempt's own in-flight time is bounded by
    // min(ENTITLEMENTS_FETCH_MS, remaining) - a dead server hangs for exactly that long, every time.
    const deadServerAttempt = async (n: number, remaining: number) => {
      calls.push({ n, remaining, startedAt: Date.now() - t0 });
      const bounded = Math.min(ENTITLEMENTS_FETCH_MS, remaining);
      await new Promise<void>((resolve) => setTimeout(resolve, bounded));
      return { failed: true } as Res;
    };
    const p = retryWithBackoff(deadServerAttempt, {
      maxAttempts: 3, backoffMs: [1000, 2000], overallBudgetMs: 22000,
    });
    // attempt 1: remaining=22000, bounded to 15000 (the per-attempt read timeout, not the budget - #1089's
    // "trades nothing for a wrong answer" point).
    t.mock.timers.tick(15000); await flushMicrotasks();
    // backoff after attempt 1: remaining=7000 > backoffMs[0]=1000, so the full 1000ms IS waited (not skipped,
    // not shortened).
    t.mock.timers.tick(1000); await flushMicrotasks();
    // attempt 2 starts at t=16000 (after that 1000ms wait), remaining=22000-16000=6000, bounded to 6000
    // (shorter than the 15s read timeout this time - the budget, not the per-attempt bound, is now
    // controlling).
    t.mock.timers.tick(6000); await flushMicrotasks();
    const out = await p;
    assert.deepEqual(calls, [
      { n: 1, remaining: 22000, startedAt: 0 },
      // 6000, not 7000: remaining is measured when attempt 2 actually STARTS, i.e. after the 1000ms backoff
      // has already been waited (22000 - 15000 attempt-1 - 1000 backoff = 6000) - not at the skip-check
      // moment right after attempt 1 returns and before that wait (which is 7000, and only decides whether
      // to skip the wait, never the number handed to the next attempt).
      { n: 2, remaining: 6000,  startedAt: 16000 },
    ], 'exact call sequence: 2 attempts, not 3 - attempt 3 must never start');
    assert.equal(out.attempts, 2, 'REGRESSION GUARD: a revert to the old no-budget loop would run all 3 attempts here');
    assert.equal(Date.now() - t0, 22000, 'REGRESSION GUARD: a revert to the old no-budget loop would take 15000*3 + 1000 + 2000 = 48000ms here, not 22000ms');
    assert.equal(out.cancelled, false);
    assert.equal(out.result.failed, true, 'the last attempt\'s own (failed) result, same contract as exhausting maxAttempts normally');
  });

  await t.test('isCancelled and overallBudgetMs together: a cancellation during the backoff wait still wins, budget or not', { timeout: 5000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelled = false;
    const calls: number[] = [];
    const attempt = async (n: number) => { calls.push(n); return { failed: true } as Res; };
    const p = retryWithBackoff(attempt, { maxAttempts: 3, backoffMs: [1000, 2000], overallBudgetMs: 22000, isCancelled: () => cancelled });
    await flushMicrotasks();
    assert.deepEqual(calls, [1]);
    cancelled = true; // e.g. the component unmounted while waiting out the backoff, budget nowhere near spent
    t.mock.timers.tick(1000); await flushMicrotasks();
    const out = await p;
    assert.deepEqual(calls, [1], 'attempt 2 never ran once cancelled fired, independent of the budget having plenty left');
    assert.equal(out.cancelled, true);
    assert.equal(out.attempts, 1);
  });
});

/* ══ AuthProvider.tsx wiring: the NEW #1173 constant + AbortSignal computation only - the settle-to-'unknown'
   exhaustion behavior itself is #1119, unchanged here, already covered elsewhere. ══ */

test('AuthProvider entitlements: ENTITLEMENTS_OVERALL_BUDGET_MS is wired into retryWithBackoff and the per-attempt AbortSignal', () => {
  const source = stripComments(read('components/AuthProvider.tsx'));
  anchorOnce(source, 'const ENTITLEMENTS_OVERALL_BUDGET_MS = 22000;', 'the 22000ms overall budget constant');
  anchorOnce(source, 'overallBudgetMs: ENTITLEMENTS_OVERALL_BUDGET_MS,', 'overallBudgetMs passed into retryWithBackoff\'s options');
  // The attempt signature must accept the remaining-budget 2nd arg, and use it - not just accept and ignore it
  // (which would silently keep the old ~48s worst case despite the option being wired above).
  anchorOnce(source, 'async function attempt(n: number, remainingBudgetMs: number)', 'attempt\'s updated signature (2nd arg: remainingBudgetMs)');
  anchorOnce(source, '.abortSignal(AbortSignal.timeout(Math.min(ENTITLEMENTS_FETCH_MS, remainingBudgetMs)))', 'the AbortSignal bounded by min(per-attempt timeout, remaining budget)');
});
