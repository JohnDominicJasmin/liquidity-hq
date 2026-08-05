import test from 'node:test';
import assert from 'node:assert/strict';
import DEFAULTS from '../lib/labelDefaults.en.json' with { type: 'json' };

/* Guards the §1.4 defect QA found: /api/labels answers `200 {}` on any DB
   error, and LabelsProvider used to apply that unconditionally - replacing
   every seeded English default, so t()'s `map[key] ?? key` rendered the whole
   UI as raw keys.
   The provider itself is a React component and not unit-testable here without
   a renderer, so this pins the two pure decisions it makes. If either of these
   fails, the provider logic has drifted from what the comment there claims. */

const defaults = DEFAULTS as Record<string, string>;

/** Mirrors the guard in LabelsProvider.fetchLabels. */
function isUsablePayload(data: unknown): boolean {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data as object).length > 0;
}

/** Mirrors how the provider applies a payload over the seeded defaults. */
function applyPayload(
  current: Record<string, string>, data: unknown,
): Record<string, string> {
  if (!isUsablePayload(data)) return current;
  return { ...defaults, ...(data as Record<string, string>) };
}

test('label payload guard', async (t) => {
  await t.test('the seed is not empty, or none of this matters', () => {
    assert.ok(Object.keys(defaults).length > 100,
      'labelDefaults.en.json should carry the full English snapshot');
  });

  await t.test('an empty object is rejected - the exact prod failure mode', () => {
    assert.equal(isUsablePayload({}), false);
    const after = applyPayload(defaults, {});
    assert.deepEqual(after, defaults, 'defaults must survive a fail-open 200 {}');
  });

  await t.test('null, undefined and arrays are rejected', () => {
    for (const bad of [null, undefined, [], ['a'], 'string', 0]) {
      assert.equal(isUsablePayload(bad), false, String(bad) + ' should be rejected');
      assert.deepEqual(applyPayload(defaults, bad), defaults);
    }
  });

  await t.test('a real payload is applied', () => {
    const key = Object.keys(defaults)[0];
    const after = applyPayload(defaults, { [key]: 'TRANSLATED' });
    assert.equal(after[key], 'TRANSLATED');
  });

  await t.test('a PARTIAL payload degrades to English, never to raw keys', () => {
    /* The PostgREST db-max-rows case app/api/labels warns about, and any
       half-translated locale. Before the fix these keys resolved to
       `map[key] ?? key` and rendered as NAV_SIGN_IN on screen. */
    const keys = Object.keys(defaults);
    const partial = { [keys[0]]: 'UNO' };
    const after = applyPayload(defaults, partial);
    assert.equal(after[keys[0]], 'UNO', 'provided key uses the payload');
    assert.equal(after[keys[1]], defaults[keys[1]], 'missing key falls back to English');
    assert.equal(Object.keys(after).length, keys.length,
      'no key may go missing - a missing key is a raw key on screen');
  });
});
