import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWrite, _resetApiHealthWriteState } from '../lib/apiHealth.ts';

/* #1219: shouldWrite coalesces per-request health writes so a burst of
 * concurrent requests to one source doesn't turn into one DB write per
 * request. Two floors: MIN_WRITE_INTERVAL_MS (30s) for a repeat of the same
 * state, MIN_STATE_CHANGE_INTERVAL_MS (5s) for a genuine ok<->down flip -
 * the #1025 fix that replaced "state changes bypass coalescing entirely"
 * (which is what let a flapping burst produce ~280 writes in ~8s).
 *
 * Date.now() is mocked (node:test's built-in timer mocking) rather than
 * using real sleeps, so this runs in milliseconds instead of tens of
 * seconds of real wall-clock waiting. */

test('#1219 shouldWrite coalescing floor', async (t) => {
  t.beforeEach(() => _resetApiHealthWriteState());

  await t.test('the first call for a source always writes - nothing to coalesce against yet', () => {
    assert.equal(shouldWrite('rss:BBC', true), true);
  });

  await t.test('a source flapping faster than the 5s floor writes at most once per 5s', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    assert.equal(shouldWrite('bybit:klines-proxy', true), true, 'first call always writes');

    // Flap ok/down/ok/down within the 5s floor - each of these represents a
    // genuine state change, and #1025 found that state changes bypassing
    // the floor entirely is exactly what turned one backend incident into
    // ~280 writes in ~8s. None of these should write.
    t.mock.timers.tick(1000);
    assert.equal(shouldWrite('bybit:klines-proxy', false), false, '1s later, state changed, under the 5s floor');
    t.mock.timers.tick(1000);
    assert.equal(shouldWrite('bybit:klines-proxy', true), false, '2s later, state changed again, still under 5s');
    t.mock.timers.tick(2900);
    assert.equal(shouldWrite('bybit:klines-proxy', false), false, '4.9s since the confirmed write, still under 5s');
  });

  await t.test('a genuine transition still writes promptly once the 5s floor has actually passed', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    assert.equal(shouldWrite('rss:BBC', true), true, 'first call always writes');

    t.mock.timers.tick(5001);
    assert.equal(shouldWrite('rss:BBC', false), true, 'state changed, 5s+ since the last confirmed write');
  });

  await t.test('a repeat of the SAME state needs the longer 30s floor, not just 5s', (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    assert.equal(shouldWrite('rss:CryptoSlate', false), true, 'first call always writes');

    t.mock.timers.tick(6000);
    assert.equal(shouldWrite('rss:CryptoSlate', false), false, 'same state, 6s later - past the 5s state-change floor but under the 30s same-state floor');

    t.mock.timers.tick(24001); // total 30001ms since the confirmed write
    assert.equal(shouldWrite('rss:CryptoSlate', false), true, 'same state, 30s+ since the last confirmed write');
  });

  await t.test('different sources are tracked independently', () => {
    assert.equal(shouldWrite('rss:BBC', true), true);
    assert.equal(shouldWrite('finnhub:crypto', true), true, 'a different source is not coalesced against BBC\'s state');
  });
});
