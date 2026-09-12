import test from 'node:test';
import assert from 'node:assert/strict';
import { onCooldown, markSent, _resetAlertCooldownState } from '../lib/alertCooldown.ts';

/* #1227 (Q6 audit) -> #1230. Extracted out of app/api/telegram/alert/route.ts
 * so the cooldown ledger is provable without a live alert run. */

test('onCooldown / markSent', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  t.afterEach(() => _resetAlertCooldownState());

  await t.test('a key that has never fired is not on cooldown', () => {
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), false);
  });

  await t.test('immediately after markSent, the same key is on cooldown', () => {
    markSent('rsi_ob_BTC');
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), true);
  });

  await t.test('cooldown holds right up to the boundary and releases exactly at it', () => {
    markSent('rsi_ob_BTC');
    t.mock.timers.tick(10 * 60_000 - 1);
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), true, 'one ms before the window ends, still on cooldown');
    t.mock.timers.tick(1);
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), false, 'at the exact window boundary, cooldown has released');
  });

  await t.test('a key past its own window stays on cooldown under a longer one checked elsewhere', () => {
    markSent('whale_BTC');
    t.mock.timers.tick(6 * 60_000);
    assert.equal(onCooldown('whale_BTC', 5 * 60_000), false, 'released under its own 5-min window');
    assert.equal(onCooldown('whale_BTC', 30 * 60_000), true, 'still held under a separate 30-min window check');
  });

  await t.test('independent keys never share cooldown state', () => {
    markSent('rsi_ob_BTC');
    assert.equal(onCooldown('rsi_ob_ETH', 10 * 60_000), false, 'a different coin is unaffected');
    assert.equal(onCooldown('rsi_os_BTC', 10 * 60_000), false, 'a different signal on the same coin is unaffected');
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), true, 'the marked key itself is still on cooldown');
  });

  await t.test('_resetAlertCooldownState clears every key, not just the one under test', () => {
    markSent('rsi_ob_BTC');
    markSent('whale_BTC');
    _resetAlertCooldownState();
    assert.equal(onCooldown('rsi_ob_BTC', 10 * 60_000), false);
    assert.equal(onCooldown('whale_BTC', 10 * 60_000), false);
  });
});
