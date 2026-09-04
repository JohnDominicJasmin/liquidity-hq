/* The label-override diff (#675).
 *
 * A row in `lhq_labels` silently wins over the shipped default, so a label fix
 * can be merged, deployed and verified on staging and still not appear in
 * production — and nothing in the build, the deploy or /api/version says so.
 * `DASH_EDGE_CB_LABEL` is the live instance: shipped "BTC CB prem", production
 * shows "CB Premium".
 *
 * This does not fix that row. It makes the class of bug readable, and the
 * comparison is pure so it can be tested without the database neither session
 * can reach.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffLabels, summarise } from '../lib/labelOverrides.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a row that differs from the default is the finding', () => {
  const rows = [{ key: 'DASH_EDGE_CB_LABEL', value: 'CB Premium' }];
  const defaults = { DASH_EDGE_CB_LABEL: 'BTC CB prem' };
  assert.deepEqual(diffLabels(rows, defaults), [
    { key: 'DASH_EDGE_CB_LABEL', dbValue: 'CB Premium', codeDefault: 'BTC CB prem', kind: 'overridden' },
  ]);
});

test('a row that AGREES with the default is not reported at all', () => {
  /* The healthy case, and the one that must stay quiet. Reporting every stored
     row would bury the handful that matter under thousands that do not — the
     same reason the ops view lists overrides rather than labels. */
  const rows = [{ key: 'A', value: 'same' }];
  assert.deepEqual(diffLabels(rows, { A: 'same' }), []);
});

test('a stored key that no longer exists in code is an orphan, not an override', () => {
  /* Different problem, so a different kind. It usually means a key was renamed
     and the old row was left behind, which puts the rename one restored backup
     away from coming back. */
  const out = diffLabels([{ key: 'GONE_KEY', value: 'x' }], { KEPT: 'y' });
  assert.equal(out.find(r => r.key === 'GONE_KEY')?.kind, 'orphan');
  assert.equal(out.find(r => r.key === 'GONE_KEY')?.codeDefault, null);
});

test('a shipped key with no row is normal and says so', () => {
  const out = diffLabels([], { ONLY_IN_CODE: 'v' });
  assert.deepEqual(out, [{ key: 'ONLY_IN_CODE', dbValue: null, codeDefault: 'v', kind: 'defaultOnly' }]);
});

test('an empty stored value is an override, not a missing row', () => {
  /* The case a truthiness check gets wrong. A row storing '' means the label
     renders blank in production while the code ships real text — strictly worse
     than a wrong string, and `value || default` would hide it completely. */
  const out = diffLabels([{ key: 'K', value: '' }], { K: 'Real text' });
  assert.equal(out[0].kind, 'overridden');
  assert.equal(out[0].dbValue, '');
});

test('a key whose default is inherited from Object.prototype is not treated as shipped', () => {
  /* `defaults['toString']` is a function on every object literal, so a naive
     `defaults[key] !== undefined` reports every row named `toString`,
     `constructor` or `hasOwnProperty` as agreeing with a default that does not
     exist. hasOwnProperty is why. */
  const out = diffLabels([{ key: 'toString', value: 'x' }], { REAL: 'y' });
  assert.equal(out.find(r => r.key === 'toString')?.kind, 'orphan');
});

test('the output is sorted, so two runs of the same data diff cleanly by eye', () => {
  const out = diffLabels(
    [{ key: 'Z', value: '1' }, { key: 'A', value: '1' }],
    { Z: '2', A: '2' },
  );
  assert.deepEqual(out.map(r => r.key), ['A', 'Z']);
});

test('summarise counts the one number that matters', () => {
  const counts = summarise(diffLabels(
    [{ key: 'OVER', value: 'db' }, { key: 'ORPHAN', value: 'x' }, { key: 'SAME', value: 's' }],
    { OVER: 'code', SAME: 's', UNSTORED: 'u' },
  ));
  assert.deepEqual(counts, { overridden: 1, orphan: 1, defaultOnly: 1 });
});

test('the real defaults file is a flat string map, which the diff assumes', () => {
  /* If labelDefaults.en.json ever nests, every value comparison becomes an
     object identity comparison and the endpoint reports the entire catalogue as
     overridden. Cheap to assert, and it fails at the moment the assumption
     breaks rather than in production. */
  const defaults = JSON.parse(readFileSync(path.join(ROOT, 'lib', 'labelDefaults.en.json'), 'utf8'));
  const bad = Object.entries(defaults).filter(([, v]) => typeof v !== 'string');
  assert.deepEqual(bad, [], 'labelDefaults.en.json has non-string values');
  assert.ok(Object.keys(defaults).length > 100, 'the defaults file looks empty - the diff would report every stored row as an orphan');
});

test('the endpoint compares English only', () => {
  /* A Spanish row is a translation, not an override of the English default.
     Comparing them would report the whole translated catalogue as overridden,
     which is the loudest possible way to say nothing. */
  const route = readFileSync(path.join(ROOT, 'app', 'api', 'ops', 'label-overrides', 'route.ts'), 'utf8');
  assert.match(route, /\.eq\('locale', 'en'\)/);
});

test('the endpoint is owner-gated and read-only', () => {
  /* It reports which production rows are masking shipped defaults - a list of
     what to change and where. And writes to the shared database go to the
     owner, so this must not grow a PATCH without that conversation. */
  const route = readFileSync(path.join(ROOT, 'app', 'api', 'ops', 'label-overrides', 'route.ts'), 'utf8');
  assert.match(route, /withOwner\(/);
  assert.equal(/export const (POST|PATCH|PUT|DELETE)/.test(route), false,
    'the label-overrides endpoint gained a write method');
});

test('the endpoint pages its query', () => {
  /* PostgREST clamps to a 1000-row cap a client .range() cannot raise, and this
     catalogue crossed it during the i18n migration. Unpaged, every key past the
     first 1000 reads as `defaultOnly` - a wrong answer that looks healthy. */
  const route = readFileSync(path.join(ROOT, 'app', 'api', 'ops', 'label-overrides', 'route.ts'), 'utf8');
  assert.match(route, /PAGE_SIZE/);
  assert.match(route, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
});

test('CONTROL: the diff reports something, so the empty results above mean something', () => {
  /* Four assertions here expect `[]` or a single kind. A function returning []
     unconditionally passes most of this file. */
  const out = diffLabels([{ key: 'K', value: 'db' }], { K: 'code' });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'overridden');
  assert.notDeepEqual(diffLabels([{ key: 'A', value: '1' }], { A: '2' }), []);
});
