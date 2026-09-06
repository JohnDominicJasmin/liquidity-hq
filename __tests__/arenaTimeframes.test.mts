/* Arena's timeframe gating — spec §Timeframe row, criteria 20-23.
 *
 * QA's coverage map puts these in the group with no automated check, where
 * "a defect reaches dev unopposed". These tests are that opposition.
 *
 * The paywall half matters most: this project shipped ConfluenceScore unguarded
 * for one commit, and every gate passed, because nothing asserted entitlement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tfState, forcedTimeframe, tfClickIntent, gatedHint, TF_ROW } from '../lib/arenaTimeframes.ts';

/* ── 1. the three states ─────────────────────────────────────────────────── */

test('free user: 1m/5m/15m are gated, the rest available', () => {
  for (const tf of ['1m', '5m', '15m']) {
    assert.equal(tfState(tf, '1h', false), 'gated', `${tf} should be gated for a free user`);
  }
  for (const tf of ['30m', '2h', '4h', '1d']) {
    assert.equal(tfState(tf, '1h', false), 'available', `${tf} should be available`);
  }
});

test('pro user: nothing is gated', () => {
  for (const tf of TF_ROW) {
    assert.notEqual(tfState(tf, '1h', true), 'gated', `${tf} must not be gated for Pro`);
  }
});

test('ACTIVE WINS over gated - the chip you are on is never a padlock', () => {
  // A lapsed Pro sitting on 5m must not see a padlock on the timeframe the
  // chart is currently showing. The padlock would describe a state the screen
  // contradicts. forcedTimeframe is what stops them being there at all.
  assert.equal(tfState('5m', '5m', false), 'active');
});

/* ── 2. the forced fallback ──────────────────────────────────────────────── */

test('a free user asking for a gated timeframe is moved to 1h', () => {
  // Bookmarks, shared links and lapsed subscriptions all land here.
  assert.equal(forcedTimeframe('5m', false), '1h');
  assert.equal(forcedTimeframe('1m', false), '1h');
});

test('an available timeframe is never rewritten', () => {
  assert.equal(forcedTimeframe('4h', false), '4h');
  assert.equal(forcedTimeframe('1d', false), '1d');
});

test('pro keeps whatever was asked for', () => {
  assert.equal(forcedTimeframe('1m', true), '1m');
  assert.equal(forcedTimeframe('5m', true), '5m');
});

/* ── 3. what a click does — the paywall half ─────────────────────────────── */

test('a gated click opens the modal and does NOT select', () => {
  // The spec is explicit: clicking a gated chip must not move the chart.
  // Selecting and then showing a modal would give away a frame of the thing
  // being sold, and leave the chart somewhere the user cannot return from.
  assert.equal(tfClickIntent('5m', false), 'upgrade');
  assert.equal(tfClickIntent('1m', false), 'upgrade');
});

test('an ungated click selects, for free and pro alike', () => {
  assert.equal(tfClickIntent('4h', false), 'select');
  assert.equal(tfClickIntent('5m', true),  'select');
});

/* ── 4. legible without colour ───────────────────────────────────────────── */

test('the free user gets an explicit hint naming the gated timeframes', () => {
  // --txt2 and --txt3 are close enough that a colour-only distinction is not
  // one. The padlock and this string carry the state.
  assert.equal(gatedHint(false), '1M · 5M · 15M NEED PRO');
});

test('pro gets no hint at all', () => {
  assert.equal(gatedHint(true), null);
});

/* ── 5. control ──────────────────────────────────────────────────────────── */

test('CONTROL: gating actually distinguishes free from pro', () => {
  // Guards against a version where `entitled` is ignored - every assertion
  // about Pro would pass on a build that gates nobody, which is the leak.
  const free = TF_ROW.map(tf => tfState(tf, '1h', false));
  const pro  = TF_ROW.map(tf => tfState(tf, '1h', true));
  assert.notDeepEqual(free, pro, 'free and pro see the same row - entitlement is not wired');
  assert.ok(free.includes('gated'), 'nothing is ever gated');
});
