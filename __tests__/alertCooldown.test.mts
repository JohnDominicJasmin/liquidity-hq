import test from 'node:test';
import assert from 'node:assert/strict';
import { onCooldown, markSent, _resetAlertCooldownState, beginStagedMarks, commitStagedMarks, discardStagedMarks, exportCooldownState } from '../lib/alertCooldown.ts';

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

/* #2425 B2: STAGED MARKS. A cooldown used to be consumed the moment an alert was QUEUED, so a Telegram 429/5xx or the /ops send pause lost the alert for its whole cooldown. While a run is staging, markSent writes to
   a side map that onCooldown also reads (two checks in one run still dedupe); the route COMMITS it into the ledger once something was delivered or DISCARDS it when nothing was. No staging = the old behaviour. */
test('staged marks (#2425 B2)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  t.afterEach(() => { discardStagedMarks(); _resetAlertCooldownState(); });
  const CD = 10 * 60_000;

  await t.test('a staged mark is visible to onCooldown inside the run (two checks in one run still dedupe)', () => {
    beginStagedMarks(); markSent('rsi_ob_BTC');
    assert.equal(onCooldown('rsi_ob_BTC', CD), true);
    assert.equal(onCooldown('rsi_os_BTC', CD), false, 'a different key is unaffected');
  });

  await t.test('a staged mark is NOT in the persisted ledger until it is committed', () => {
    beginStagedMarks(); markSent('rsi_ob_BTC');
    assert.deepEqual(exportCooldownState(), {}, 'a staged mark leaked into the exported ledger: a restart now would remember an alert that was never sent');
  });

  await t.test('discard drops the marks: not on cooldown afterwards, nothing exported, the dropped count is returned, and staging stops', () => {
    beginStagedMarks(); markSent('rsi_ob_BTC'); markSent('fng_fear');
    assert.equal(discardStagedMarks(), 2);
    assert.equal(onCooldown('rsi_ob_BTC', CD), false, 'a discarded mark still silenced the alert');
    assert.equal(onCooldown('fng_fear', CD), false);
    assert.deepEqual(exportCooldownState(), {});
    markSent('after_discard');                                      // staging is over: this writes straight to the ledger, as before
    assert.deepEqual(Object.keys(exportCooldownState()), ['after_discard']);
    assert.equal(discardStagedMarks(), 0, 'discarding with no staging in progress drops nothing');
  });

  await t.test('commit writes the staged marks into the ledger (exported, on cooldown) and stops staging', () => {
    beginStagedMarks(); markSent('rsi_ob_BTC');
    commitStagedMarks();
    assert.equal(onCooldown('rsi_ob_BTC', CD), true);
    assert.deepEqual(Object.keys(exportCooldownState()), ['rsi_ob_BTC']);
    markSent('later');                                              // no staging now
    assert.deepEqual(Object.keys(exportCooldownState()).sort(), ['later', 'rsi_ob_BTC']);
    commitStagedMarks();                                            // committing with nothing staged is a no-op
    assert.deepEqual(Object.keys(exportCooldownState()).sort(), ['later', 'rsi_ob_BTC']);
  });

  await t.test('with NO staging, markSent writes straight to the ledger exactly as before', () => {
    markSent('rsi_ob_BTC');
    assert.equal(onCooldown('rsi_ob_BTC', CD), true);
    assert.deepEqual(Object.keys(exportCooldownState()), ['rsi_ob_BTC']);
  });

  await t.test('beginStagedMarks drops marks left by a run that never finished', () => {
    beginStagedMarks(); markSent('stale_run');
    beginStagedMarks();
    assert.equal(onCooldown('stale_run', CD), false, 'a mark from an unfinished run silenced an alert in the next one');
  });

  await t.test('a committed mark keeps its time: it releases at the same boundary as an unstaged one', () => {
    beginStagedMarks(); markSent('whale_BTC'); commitStagedMarks();
    t.mock.timers.tick(CD - 1); assert.equal(onCooldown('whale_BTC', CD), true);
    t.mock.timers.tick(1); assert.equal(onCooldown('whale_BTC', CD), false);
  });
});
