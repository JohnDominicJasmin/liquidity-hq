import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthGradeA11y, healthLabelKey } from '../lib/healthGradeA11y.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import defaults from '../lib/labelDefaults.en.json' with { type: 'json' };

/* #874. The coin health-grade badge had no accessible name.
 *
 * WHAT THIS CAN AND CANNOT PIN. The defect was in the accessibility tree, and
 * a node test cannot read one - the browser computes it. So the render-level
 * proof is in the PR (three variants measured live: role+label named it,
 * label-alone named it, role-alone left it UNNAMED, which is why a name has
 * to be supplied rather than a role added). What is pinned here is everything
 * that feeds that name, because those are the parts that rot silently.
 */

const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;

const t = (key: string, vars?: Record<string, string | number>) => {
  const raw = (defaults as Record<string, string>)[key];
  assert.ok(raw !== undefined, `missing English default for ${key}`);
  return vars
    ? raw.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
    : raw;
};

test('the badge gets a role that can legally carry a name', () => {
  const { role } = healthGradeA11y('D', 'COIN_HEALTH_GRADE_D', t);
  assert.equal(role, 'img');
});

test('the name spells the grade out, rather than being the bare letter', () => {
  const { 'aria-label': label } = healthGradeA11y('F', 'COIN_HEALTH_GRADE_F', t);
  assert.equal(label, 'Health grade F, No clear setup');
  /* The whole point. "F" is announceable and useless; a screen reader user
     needs what the letter stands for, which sighted users read off the rail
     in context. */
  assert.notEqual(label, 'F');
});

test('every grade produces a name with no unresolved placeholder', () => {
  for (const g of GRADES) {
    const { 'aria-label': label } = healthGradeA11y(g, `COIN_HEALTH_GRADE_${g}` as never, t);
    assert.ok(label.includes(g), `${g}: the letter itself should survive into the name`);
    assert.ok(!label.includes('{'), `${g}: unresolved interpolation in "${label}"`);
  }
});

/* ── The two meanings of F ──────────────────────────────────────────────────
   This is the case the labelKey exists for, and the one most likely to be
   quietly broken by a later refactor. Grade F is returned BOTH when the coin
   was measured and found unworthy, and when there was nothing to measure.
   Same letter, different meaning, and the accessible name is the only place a
   user is told which. */

test('no data and no setup are both grade F, and they do NOT say the same thing', () => {
  assert.equal(healthLabelKey('F', false), 'COIN_HEALTH_NO_DATA');
  assert.equal(healthLabelKey('F', true), 'COIN_HEALTH_GRADE_F');

  const measured = healthGradeA11y('F', healthLabelKey('F', true), t)['aria-label'];
  const unmeasured = healthGradeA11y('F', healthLabelKey('F', false), t)['aria-label'];

  assert.equal(unmeasured, 'Health grade F, No data');
  assert.notEqual(
    measured, unmeasured,
    'if these collapse, "we looked and it is bad" and "we never looked" became indistinguishable',
  );
});

test('the no-data branch wins over the grade, whatever the grade says', () => {
  /* hasData:false must not be overridden by the letter. computeCoinHealth
     returns 'F' on its no-data path today, but if that default ever changes
     the name must still say "No data" rather than grade the unmeasured. */
  for (const g of GRADES) {
    assert.equal(healthLabelKey(g, false), 'COIN_HEALTH_NO_DATA', `grade ${g} with no data`);
  }
});

/* NOT COVERED, ANYWHERE, and named rather than left implied: that
   computeCoinHealth passes hasData correctly, and that "No data" ever reaches
   a screen.

   marketStore cannot be imported under `npm test` - it is bare `node --test`
   with no TS loader, and marketStore's extensionless imports do not resolve -
   so the call site is not unit-testable from here.

   Nor was it observed. The four rail sites all render behind `d?.price &&`,
   so the no-data branch CANNOT reach them: measured on /dashboard, 16 cards
   rendered and 8 badges, the other 8 priceless cards showing no badge at all.
   /arena's badge is ungated and is the one place the branch can surface, but
   the market store was warm on every attempt and it read a measured grade
   each time.

   So: "No data" is unit-tested and unrendered. Stated plainly because the
   alternative - writing "verified by render" next to a render nobody saw - is
   the exact failure this file's own header is about. */

/* ── Drift ─────────────────────────────────────────────────────────────────
   Same shape as navOwnNavRoutes' locale check: a key that exists in one file
   and not the other fails at runtime as an empty or literal-key label, which
   is exactly the silent-degradation this repo keeps having to find by eye. */

test('every key the badge can resolve to is declared AND has an English default', () => {
  const keys = [
    'COIN_HEALTH_GRADE_ARIA',
    'COIN_HEALTH_NO_DATA',
    ...GRADES.map(g => `COIN_HEALTH_GRADE_${g}`),
  ];
  for (const k of keys) {
    assert.ok(
      (LABEL_KEYS as readonly string[]).includes(k),
      `${k} is used by the badge but not declared in labelKeys.ts`,
    );
    assert.ok(
      k in (defaults as Record<string, string>),
      `${k} is declared but has no string in labelDefaults.en.json`,
    );
  }
});

test('the frame carries both placeholders, or half the name silently vanishes', () => {
  const frame = (defaults as Record<string, string>)['COIN_HEALTH_GRADE_ARIA'];
  assert.match(frame, /\{grade\}/);
  assert.match(frame, /\{label\}/);
});
