/* Arena colour rules — spec §Colour is data, criteria 12-18.
 *
 * QA's coverage map: no stub exists to drive a coloured state, so inspection is
 * the only check and a defect reaches dev unopposed. These tests are that
 * opposition.
 *
 * The thing being defended against is specific and it is NOT "wrong colours".
 * It is a page where everything signed is coloured — which looks better, is
 * wrong, and passes design-tokens, contrast and the palette check, because
 * --green is a legal token everywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evidencePaint, verdictPaint, factorPaint, mtfPaint, structurePaint,
  emaConditionPaint, clusterPaint, EMA_VALUE_COLOUR, LEVEL_COLOUR,
} from '../lib/arenaColour.ts';

/* ── 1. the rule that generalises: sign is not direction ─────────────────── */

test('a POSITIVE value that did not fire renders --txt, not green', () => {
  // The spec's own table: OI 1H +2.31%, VWAP +0.42%, BASIS +0.18% — all
  // positive, all --txt. This is the whole defect in one assertion.
  const quiet = evidencePaint(null, true);
  assert.equal(quiet.value, 'var(--txt)');
  assert.equal(quiet.marker, 'var(--mark-idle)');
});

test('a positive value that fired as a WARNING renders red', () => {
  // FUNDING 8H is +0.0132% and red — crowded long is a warning.
  assert.equal(evidencePaint('red', true).value, 'var(--red)');
});

test('a missing value is --txt2 and never a zero', () => {
  const none = evidencePaint(null, false);
  assert.equal(none.value, 'var(--txt2)');
  assert.equal(none.marker, 'var(--mark-idle)');
});

/* ── 2. verdict follows the read ─────────────────────────────────────────── */

test('verdict colour switches with direction and is never hardcoded green', () => {
  assert.equal(verdictPaint('bull'), 'var(--green)');
  assert.equal(verdictPaint('bear'), 'var(--red)');
  assert.equal(verdictPaint('neutral'), 'var(--txt2)');
  assert.equal(verdictPaint(null), 'var(--txt2)');
});

/* ── 3. a cleared penalty is quiet, not green ────────────────────────────── */

test('an INACTIVE penalty is --txt3, not green', () => {
  // A cleared risk is a good outcome. Green would mean a factor voted bullish,
  // and a penalty that did not fire cast no vote — rendering it green makes an
  // absent risk look like a positive signal.
  const clear = factorPaint({ kind: 'penalty', active: false });
  assert.equal(clear.value, 'var(--txt3)');
  assert.notEqual(clear.value, 'var(--green)');
});

test('an ACTIVE penalty is accent with a tinted row, not red', () => {
  const hit = factorPaint({ kind: 'penalty', active: true });
  assert.equal(hit.value, 'var(--accent)');
  assert.equal(hit.background, 'rgba(217,166,38,.06)');
});

test('a neutral directional factor is quiet', () => {
  assert.equal(factorPaint({ kind: 'directional', dir: 'neutral' }).value, 'var(--txt3)');
});

/* ── 4. thresholds, not midpoints ────────────────────────────────────────── */

test('RSI 50 is NEUTRAL - the threshold is 57/43, not 50', () => {
  // The easy wrong version treats >50 as bullish, which colours half the
  // timeframes green on an ordinary day.
  assert.equal(mtfPaint(50).label, 'NEUTRAL');
  assert.equal(mtfPaint(56).label, 'NEUTRAL');
  assert.equal(mtfPaint(58).label, 'BULLISH');
  assert.equal(mtfPaint(42).label, 'BEARISH');
});

test('MTF with no data is neutral-coloured, not absent', () => {
  assert.equal(mtfPaint(null).colour, 'var(--txt3)');
});

/* ── 5. direction only, never significance ───────────────────────────────── */

test('structure colour carries direction; a CHoCH is not louder than a BOS', () => {
  assert.equal(structurePaint('up'), 'var(--green)');
  assert.equal(structurePaint('down'), 'var(--red)');
});

test('cluster colour takes SIDE, not size', () => {
  // Below spot is long liquidations, above is short. Scaling by size would
  // make a big cluster read as a strong signal.
  assert.equal(clusterPaint(113_400, 115_284), 'var(--red)');
  assert.equal(clusterPaint(119_600, 115_284), 'var(--green)');
});

/* ── 6. things that are never signals ────────────────────────────────────── */

test('EMA average values and price levels are always --txt', () => {
  // Line colour is a chart concern; a price is not a signal.
  assert.equal(EMA_VALUE_COLOUR, 'var(--txt)');
  assert.equal(LEVEL_COLOUR, 'var(--txt)');
});

test('EMA conditions colour the glyph, and a fail dims the label', () => {
  assert.deepEqual(emaConditionPaint(true),  { glyph: '✓', glyphColour: 'var(--green)', labelColour: 'var(--txt)' });
  assert.deepEqual(emaConditionPaint(false), { glyph: '✕', glyphColour: 'var(--red)',   labelColour: 'var(--txt2)' });
});

/* ── 7. control ──────────────────────────────────────────────────────────── */

test('CONTROL: the module can return quiet AND signed colours', () => {
  // Guards both failure directions. A build that colours everything passes
  // every "is it green" assertion; a build that colours nothing passes every
  // "is it --txt" one. Both must be impossible.
  const seen = new Set([
    evidencePaint(null, true).value,
    evidencePaint('green', true).value,
    evidencePaint('red', true).value,
  ]);
  assert.equal(seen.size, 3, 'evidence paint collapses distinct states into one colour');
});
