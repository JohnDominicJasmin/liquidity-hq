/* #413 - the redesign flag, and which destination owns which route.
 *
 * Both are pure and both decide something a user sees, so both live outside
 * the .tsx. Third time this week that rule has paid for itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDesignMode, designAttribute } from '../lib/designMode.ts';

/* ── 1. the flag defaults OFF ────────────────────────────────────────────── */

test('no query and no stored preference means the CURRENT design', () => {
  // The whole safety property: nobody sees the redesign by accident, and a
  // deploy of this branch changes nothing for anyone.
  assert.equal(resolveDesignMode('', null), 'current');
  assert.equal(resolveDesignMode(null, undefined), 'current');
  assert.equal(resolveDesignMode('coin=btc&tf=15m', null), 'current');
});

test('a stored preference persists across navigation', () => {
  assert.equal(resolveDesignMode('', 'terminal'), 'terminal');
});

/* ── 2. the query param wins, in BOTH directions ─────────────────────────── */

test('?design=terminal turns it on even with nothing stored', () => {
  assert.equal(resolveDesignMode('design=terminal', null), 'terminal');
});

test('?design=current turns it OFF again - the escape hatch', () => {
  // Without this the only way out of the redesign is devtools or clearing
  // site data, which is a bad trap to leave for whoever reviews it.
  assert.equal(resolveDesignMode('design=current', 'terminal'), 'current');
});

test('an unrecognised value falls back to what was stored, not to terminal', () => {
  assert.equal(resolveDesignMode('design=purple', 'terminal'), 'terminal');
  assert.equal(resolveDesignMode('design=purple', null), 'current');
  assert.equal(resolveDesignMode('design=', null), 'current');
});

/* ── 3. the attribute ────────────────────────────────────────────────────── */

test('current REMOVES the attribute rather than setting a second value', () => {
  // There is no [data-design="current"] block and there must never be one -
  // the current design is what :root already does, and a second selector for
  // it would give every token two homes.
  assert.equal(designAttribute('current'), null);
  assert.equal(designAttribute('terminal'), 'terminal');
});

/* ── 4. control ──────────────────────────────────────────────────────────── */

test('CONTROL: resolveDesignMode can return both values', () => {
  // Guards against a version that always answers 'current' - every assertion
  // above except two would still pass.
  const seen = new Set([
    resolveDesignMode('design=terminal', null),
    resolveDesignMode('', null),
  ]);
  assert.equal(seen.size, 2, 'the flag never turns on - it is not a flag');
});
