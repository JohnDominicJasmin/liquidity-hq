/* #311 - 10Y real yield signal.
 *
 * The cases that matter here are the ones where the data is absent or old.
 * Getting a direction slightly wrong is a bad signal; rendering Friday's yield
 * as Sunday's reading is a confident lie, and that is the failure this project
 * keeps repeating (#298, #307).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFredCsv } from '../lib/fred.ts';
import {
  computeRealYield, REAL_YIELD_THRESHOLD_BP, REAL_YIELD_STALE_MS,
} from '../lib/realYield.ts';
import type { FredRow } from '../lib/fred.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0); // 2026-08-12, a Wednesday

/** Two observations a day apart, the later one `bp` basis points higher. */
function series(bp: number, latestAgeMs = DAY): FredRow[] {
  const latest = NOW - latestAgeMs;
  return [[latest - DAY, 1.80], [latest, 1.80 + bp / 100]];
}

test('a rise beyond the threshold reads as tightening', () => {
  const r = computeRealYield(series(+12), NOW);
  assert.equal(r.signal, 'tightening');
  assert.equal(r.changeBp, 12);
  assert.equal(r.stale, false);
  assert.match(r.note, /headwind/);
});

test('a fall beyond the threshold reads as easing', () => {
  const r = computeRealYield(series(-15), NOW);
  assert.equal(r.signal, 'easing');
  assert.equal(r.changeBp, -15);
  assert.match(r.note, /tailwind/);
});

test('the threshold is inclusive at exactly +/-10bp, and quiet inside it', () => {
  assert.equal(computeRealYield(series(REAL_YIELD_THRESHOLD_BP), NOW).signal, 'tightening');
  assert.equal(computeRealYield(series(-REAL_YIELD_THRESHOLD_BP), NOW).signal, 'easing');
  assert.equal(computeRealYield(series(9), NOW).signal, 'neutral');
  assert.equal(computeRealYield(series(-9), NOW).signal, 'neutral');
  assert.equal(computeRealYield(series(0), NOW).signal, 'neutral');
});

test('the change is basis points, not percent change', () => {
  // 1.80 -> 1.90 is +10bp. As a percent change it is +5.6%, and reporting that
  // next to "DXY -0.3%" would read as a violent day rather than a routine one.
  const r = computeRealYield([[NOW - 2 * DAY, 1.80], [NOW - DAY, 1.90]], NOW);
  assert.equal(r.changeBp, 10);
  assert.equal(r.value, 1.9);
});

test('an observation older than the stale window degrades to unknown', () => {
  const r = computeRealYield(series(+40, REAL_YIELD_STALE_MS + DAY), NOW);
  assert.equal(r.signal, 'unknown');
  assert.equal(r.stale, true);
  // The value is still carried - it is real, just old. What must not survive is
  // the SIGNAL, because a 40bp move six days ago is not today's backdrop.
  assert.equal(r.changeBp, 40);
  assert.match(r.note, /cannot be checked/);
});

test('a long weekend is not stale - Friday read on Tuesday still counts', () => {
  // Fri observation, read Tue morning after a Monday holiday: ~4.4 days.
  const r = computeRealYield(series(+12, 4.4 * DAY), NOW);
  assert.equal(r.stale, false);
  assert.equal(r.signal, 'tightening');
});

test('one observation is not enough to state a direction', () => {
  const r = computeRealYield([[NOW - DAY, 1.83]], NOW);
  assert.equal(r.signal, 'unknown');
  assert.equal(r.value, null);
  assert.match(r.note, /unavailable/);
});

test('no observations reports unavailable rather than zero', () => {
  const r = computeRealYield([], NOW);
  assert.equal(r.signal, 'unknown');
  assert.equal(r.value, null);
  assert.equal(r.changeBp, null);
});

test("FRED's '.' no-data rows are dropped, not parsed as NaN", () => {
  // Saturday and Sunday carry a literal '.' in the CSV. parseFloat('.') is NaN,
  // and a NaN reaching computeRealYield would render as a confident dash.
  const rows = parseFredCsv(
    'DATE,DFII10\n2026-08-07,1.83\n2026-08-08,.\n2026-08-09,.\n2026-08-10,1.91\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r[1]), [1.83, 1.91]);
  assert.ok(rows.every(([, v]) => !isNaN(v)));

  // And the signal computed from them uses the two real observations.
  const r = computeRealYield(rows, Date.UTC(2026, 7, 10, 23));
  assert.equal(r.changeBp, 8);
  assert.equal(r.signal, 'neutral');
});

test('parseFredCsv survives a truncated or headerless body', () => {
  assert.deepEqual(parseFredCsv(''), []);
  assert.deepEqual(parseFredCsv('DATE,DFII10\n'), []);
  assert.deepEqual(parseFredCsv('DATE,DFII10\nnot-a-date,1.83\n'), []);
});
