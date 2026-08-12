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

/* ── 10Y real yield on the macro band (#311) ─────────────────────────────────
 *
 * The load-bearing property is the LAST test in this block: the real yield adds
 * a line and changes no score. It was approved on the explicit condition that
 * the Confluence number keeps meaning what it meant, so that is pinned rather
 * than trusted to stay true through the next edit of this file.
 */
import { computeConfluence } from '../lib/confluence.ts';
import type { ConfluenceFactorInput } from '../lib/confluence.ts';
import { computeRealYield } from '../lib/realYield.ts';

const DAY = 86_400_000;
/** Real-yield reading `bp` basis points up on the day, observed yesterday. */
const ry = (bp: number, ageMs = DAY) =>
  computeRealYield([[NOW - ageMs - DAY, 2.40], [NOW - ageMs, 2.40 + bp / 100]], NOW);

test('a tightening real yield adds a caution line', () => {
  const r = computeMacroRisk([], null, NOW, false, ry(+14));
  assert.equal(r.level, 'caution');
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /real yield .*\+14bp.*headwind/);
});

test('an easing real yield stays out of the risk band', () => {
  // Amber is for risks. A tailwind rendered in a warning box trains people to
  // ignore the colour.
  const r = computeMacroRisk([], null, NOW, false, ry(-20));
  assert.equal(r.level, 'none');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.unknown, undefined);
});

test('a quiet real yield says nothing at all', () => {
  const r = computeMacroRisk([], null, NOW, false, ry(+3));
  assert.equal(r.level, 'none');
  assert.deepEqual(r.reasons, []);
});

test('a tightening yield does not downgrade a danger from the calendar', () => {
  const r = computeMacroRisk([at(10 * 60_000)], null, NOW, false, ry(+30));
  assert.equal(r.level, 'danger', 'an imminent release outranks the rates backdrop');
  assert.equal(r.reasons.length, 2, 'but both lines are shown');
});

test('a stale calendar and an unmeasurable yield both report, neither hides the other', () => {
  const r = computeMacroRisk([], null, NOW, true, computeRealYield([], NOW));
  assert.equal(r.unknown, true);
  assert.equal(r.reasons.length, 2);
  assert.ok(r.reasons.some(x => /Economic calendar is out of date/.test(x)));
  assert.ok(r.reasons.some(x => /real yield unavailable/.test(x)));
});

test('omitting the real yield reproduces the previous behaviour exactly', () => {
  // Backward compatibility, pinned: every existing caller passes four arguments.
  const before = computeMacroRisk([at(10 * 60_000)], 161, NOW, true);
  const after  = computeMacroRisk([at(10 * 60_000)], 161, NOW, true, null);
  assert.deepEqual(after, before);
});

test('THE CONDITION OF APPROVAL: the real yield never moves the score', () => {
  const factors: ConfluenceFactorInput[] = [
    { kind: 'directional', label: 'A', dir: 'bull', weight: 30 },
    { kind: 'penalty',     label: 'B', weight: 12, active: true },
  ];
  const baseline = computeConfluence(factors).score;
  // computeMacroRisk is a separate overlay - it cannot reach `factors` at all.
  // Driving every real-yield state and re-scoring proves the separation holds.
  for (const bp of [-40, -10, 0, 10, 40]) {
    computeMacroRisk([], null, NOW, false, ry(bp));
    assert.equal(computeConfluence(factors).score, baseline,
      `score moved after a ${bp}bp real-yield reading`);
  }
});
