import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMacroRisk } from '../lib/confluence.ts';

/* `level: 'none'` from a stale calendar is a FALSE NEGATIVE (#298).
 *
 * The econ snapshot is written by a cron. When that writer stops, the events
 * still in the snapshot are handled correctly - expired ones are dropped by
 * NewsProvider's `h < -24` filter and by the five-minute floor in
 * computeMacroRisk. What breaks is the SET: a release scheduled or corrected
 * since the writer stopped is simply absent, the search finds nothing, and the
 * card reports "no macro risk" exactly as confidently as when there is none.
 *
 * Non-prod has no ingest schedule at all by deliberate decision (#261), so those
 * hosts sit permanently in this state.
 *
 * WHAT THESE PIN, and the second one matters more than the first: that stale
 * turns an empty result into `unknown`, and that it does NOT touch a result the
 * calendar actually produced. A guard that downgraded every verdict would pass a
 * test written only for the first.
 */

const HOUR = 3600_000;
const NOW = Date.parse('2026-08-12T12:00:00Z');

const at = (offsetMs: number, name = 'CPI') => ({
  name, type: 'CPI', impact: 'high',
  isoDate: new Date(NOW + offsetMs).toISOString(),
});

test('fresh calendar with nothing upcoming reports none, not unknown', () => {
  const r = computeMacroRisk([at(48 * HOUR)], null, NOW, false);
  assert.equal(r.level, 'none');
  assert.equal(r.unknown, undefined, 'a fresh empty result must not be marked unknown');
});

test('stale calendar with nothing found reports unknown, not a clean none', () => {
  const r = computeMacroRisk([at(48 * HOUR)], null, NOW, true);
  assert.equal(r.level, 'none');
  assert.equal(r.unknown, true, 'a stale set cannot support the claim that nothing is upcoming');
  assert.match(r.reasons[0], /out of date/i, 'the reason must say WHY it cannot be checked');
});

test('CONTROL: stale does not override a real finding', () => {
  /* The whole risk of this change is that it downgrades everything to "unknown"
     and the card stops saying anything useful. A stale calendar that still
     surfaced an imminent event has done its job for that event. */
  const fresh = computeMacroRisk([at(20 * 60_000)], null, NOW, false);
  const stale = computeMacroRisk([at(20 * 60_000)], null, NOW, true);
  assert.equal(fresh.level, 'danger');
  assert.equal(stale.level, 'danger', 'a found event is a found event regardless of the set is age');
  assert.equal(stale.unknown, undefined, 'do not mark a real finding unknown');
  assert.deepEqual(stale.reasons, fresh.reasons);
});

test('CONTROL: the USD/JPY factor is unaffected - it does not come from the calendar', () => {
  /* This is the case that would break silently: jpyUsd raises the level without
     any calendar involvement, so blanking on `stale` would discard a signal the
     calendar never provided. */
  const stale = computeMacroRisk([], 161, NOW, true);
  assert.equal(stale.level, 'danger');
  assert.equal(stale.unknown, undefined);
  assert.match(stale.reasons.join(' '), /USD\/JPY/);
});

test('a stale calendar with a quiet USD/JPY still reports unknown', () => {
  const r = computeMacroRisk([], 140, NOW, true);
  assert.equal(r.level, 'none');
  assert.equal(r.unknown, true);
});

test('the default is unchanged, so every existing caller behaves as before', () => {
  const withoutArg = computeMacroRisk([at(48 * HOUR)], null, NOW);
  const explicitFresh = computeMacroRisk([at(48 * HOUR)], null, NOW, false);
  assert.deepEqual(withoutArg, explicitFresh);
  assert.equal(withoutArg.unknown, undefined);
});
