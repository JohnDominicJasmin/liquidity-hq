import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstVenueThatAnswers, type VenueAttempt } from '@/lib/venueFallback';

/* #1263 / #1767: THE FALLBACK THAT WAS DOCUMENTED, REVIEWED, AND ABSENT.
 *
 * Three call sites wrote `if (bySym) return fetchBybit(...); if (bnSym) return fetchBinance(...)` with no
 * `try`, so the second line ran only for a coin Bybit does not LIST - the one case that is not a fallback.
 * `lib/useEMAStrategy.ts` carried the comment "Bybit primary, Binance fallback" directly above it. The owner
 * reported the symptom: "Signal unavailable right now" under the Arena chart, with a working second source
 * one unreached line below.
 *
 * WHY A UNIT SUITE AND NOT ONLY THE E2E. `qa/e2e/arena-venue-fallback.spec.ts` proves the fallback RUNS in a
 * browser by forcing Bybit to 502, which is the thing the owner saw. It cannot cheaply reach the branches
 * this file is about: a venue with no symbol, a venue resolving a legitimately falsy value, the ORDER of the
 * names inside the combined error, or the absence of an `onFallback` call on the last attempt. Those are
 * decisions in nine lines of dependency-free code, so they are tested as nine lines of code.
 *
 * EVERY ASSERTION BELOW IS A SENTENCE FROM THE MODULE'S OWN HEADER. Where the header promises something the
 * obvious implementation gets wrong - skip nulls without counting them as failures, name EVERY venue rather
 * than the last, attempt strictly in order - the test names the wrong version it is there to catch. */

/** An attempt that records when it ran, so order and non-execution are both assertable. */
const ok = <T,>(venue: string, value: T, log: string[] = []): VenueAttempt<T> => ({
  venue,
  run: async () => {
    log.push(venue);
    return value;
  },
});

const fails = (venue: string, message: string, log: string[] = []): VenueAttempt<never> => ({
  venue,
  run: async () => {
    log.push(venue);
    throw new Error(message);
  },
});

test('V1: the first venue that answers wins, and no later venue is even called', async () => {
  const log: string[] = [];
  const got = await firstVenueThatAnswers(
    [ok('Bybit', 'candles', log), ok('Binance futures', 'WRONG', log)],
    'btc',
  );

  assert.equal(got, 'candles');
  /* Not merely "Bybit ran" - Binance must NOT have. A `Promise.all`-shaped rewrite would pass a
     value-only assertion while doubling every request the Arena makes. */
  assert.deepEqual(log, ['Bybit'], 'the fallback must not be called when the primary answers');
});

test('V2: a venue that resolves a falsy value has ANSWERED, and is returned as-is', async () => {
  /* The trap in `return await live[i].run()` is the version that looks tidier:
         const r = await live[i].run(); if (r) return r;
     An empty candle array, a 0, a false, a null - all legitimate answers for some subject - would then fall
     through to the fallback, and when the last venue answers falsy too the caller gets
     "All venues failed" for a run in which NOTHING failed. Four values because the bug is about
     falsiness, not about any one of them. */
  const log: string[] = [];
  assert.deepEqual(await firstVenueThatAnswers([ok('Bybit', [], log)], 'btc'), []);
  assert.equal(await firstVenueThatAnswers([ok('Bybit', 0, log)], 'btc'), 0);
  assert.equal(await firstVenueThatAnswers([ok('Bybit', false, log)], 'btc'), false);
  assert.equal(await firstVenueThatAnswers([ok('Bybit', null, log)], 'btc'), null);
  assert.deepEqual(log, ['Bybit', 'Bybit', 'Bybit', 'Bybit'], 'each call used the primary and stopped there');
});

test('V3: a null entry is "no symbol here", skipped WITHOUT counting as a failure', async () => {
  const log: string[] = [];
  const got = await firstVenueThatAnswers(
    [null, undefined, ok('Binance futures', 'candles', log)],
    'hype',
  );

  assert.equal(got, 'candles');
  assert.deepEqual(log, ['Binance futures']);
});

test('V4: a subject no venue lists gets "No venue", NOT "All venues failed"', async () => {
  /* The distinction is the whole reason the null filter runs before the loop. A Bybit-only coin whose
     Bybit entry is missing has not suffered an outage, and reporting one sends the next reader to the
     exchange status page instead of to the symbol map. */
  await assert.rejects(
    () => firstVenueThatAnswers([null, undefined], 'nosuchcoin'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'No venue for nosuchcoin');
      return true;
    },
  );

  /* An empty list is the same condition and must not read as a successful no-op. */
  await assert.rejects(
    () => firstVenueThatAnswers([], 'btc'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'No venue for btc');
      return true;
    },
  );
});

test('V5: the primary failing hands over to the fallback - the bug this module exists for', async () => {
  const log: string[] = [];
  const got = await firstVenueThatAnswers(
    [fails('Bybit', 'HTTP 502', log), ok('Binance futures', 'candles', log)],
    'btc',
  );

  assert.equal(got, 'candles', 'a 502 on the primary must not reach the user as "signal unavailable"');
  /* Order matters as much as the outcome: the fallback starts only AFTER the primary has failed. That is
     the latency cost the header warns about (worst case is the SUM of the timeouts, not the max), and it
     is the observable difference between this and a race. */
  assert.deepEqual(log, ['Bybit', 'Binance futures']);
});

test('V6: when everything fails, ONE error names every venue and its own message, in order', async () => {
  /* Throwing only the last error is the obvious implementation and it hides the primary's failure behind
     the fallback's - and the primary is the one that normally works. So this asserts the WHOLE string:
     both venues, both messages, the separator, and the order. */
  await assert.rejects(
    () =>
      firstVenueThatAnswers(
        [fails('Bybit', 'HTTP 502'), fails('Binance futures', 'HTTP 451')],
        'hype',
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(
        err.message,
        'All venues failed for hype - Bybit: HTTP 502; Binance futures: HTTP 451',
      );
      return true;
    },
  );
});

test('V7: a thrown non-Error is still named rather than swallowed as [object Object]', async () => {
  /* `fetch` rejections are Errors, but a route that throws a string or a value - or a library that rejects
     with a response object - must not erase the venue's entry from the combined message. */
  await assert.rejects(
    () =>
      firstVenueThatAnswers(
        [
          { venue: 'Bybit', run: async () => Promise.reject('plain string') },
          { venue: 'Binance futures', run: async () => Promise.reject(503) },
        ],
        'btc',
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(
        err.message,
        'All venues failed for btc - Bybit: plain string; Binance futures: 503',
      );
      return true;
    },
  );
});

test('V8: onFallback fires per handover, with the venue that failed, its error, and the one next to try', async () => {
  const calls: Array<{ failed: string; message: string; next: string }> = [];
  const got = await firstVenueThatAnswers(
    [fails('Bybit', 'HTTP 502'), fails('Binance futures', 'HTTP 451'), ok('Coinbase', 'candles')],
    'btc',
    (failed, err, next) =>
      calls.push({ failed, message: err instanceof Error ? err.message : String(err), next }),
  );

  assert.equal(got, 'candles');
  assert.deepEqual(calls, [
    { failed: 'Bybit', message: 'HTTP 502', next: 'Binance futures' },
    { failed: 'Binance futures', message: 'HTTP 451', next: 'Coinbase' },
  ]);
});

test('V9: onFallback does NOT fire for the last attempt, and nulls do not fake a next one', async () => {
  /* The log line reads "falling back to X", so firing it when there is no X is a false statement in the
     logs during an outage - the worst possible moment for one. A trailing `null` is the subtle case: it
     occupies an index without being attemptable, so an implementation that looked at `attempts[i + 1]`
     instead of the FILTERED list would announce a fallback to a venue it cannot call. */
  const announced: string[] = [];
  const onFallback = (_f: string, _e: unknown, next: string) => announced.push(next);

  await assert.rejects(
    () => firstVenueThatAnswers([fails('Bybit', 'HTTP 502')], 'btc', onFallback),
    /All venues failed for btc/,
  );
  assert.deepEqual(announced, [], 'a single failing venue has nothing to fall back to');

  await assert.rejects(
    () => firstVenueThatAnswers([fails('Bybit', 'HTTP 502'), null, undefined], 'btc', onFallback),
    /All venues failed for btc/,
  );
  assert.deepEqual(announced, [], 'trailing nulls are not a next venue');

  /* And the positive control for the same filter: a null BETWEEN two live venues must still announce the
     real one, so the empty results above are the filter working rather than onFallback never firing. */
  await firstVenueThatAnswers(
    [fails('Bybit', 'HTTP 502'), null, ok('Binance futures', 'candles')],
    'btc',
    onFallback,
  );
  assert.deepEqual(announced, ['Binance futures']);
});

test('V10: omitting onFallback is supported - this module logs nothing on its own', async () => {
  /* Three call sites pass a logger and the module must not require one; `onFallback?.()` is the contract
     and a bare `onFallback()` would throw INSIDE the catch block, converting a recoverable primary failure
     into a hard error. Asserted because it is invisible in any test that happens to pass a logger. */
  assert.equal(
    await firstVenueThatAnswers([fails('Bybit', 'HTTP 502'), ok('Binance futures', 'candles')], 'btc'),
    'candles',
  );

  await assert.rejects(
    () => firstVenueThatAnswers([fails('Bybit', 'HTTP 502'), fails('Binance futures', 'HTTP 451')], 'btc'),
    /All venues failed for btc - Bybit: HTTP 502; Binance futures: HTTP 451/,
  );
});
