import test from 'node:test';
import assert from 'node:assert/strict';

/* #1342 (auth-token-timing races, tracker) - written BEFORE Dev's fix, per
 * PM/DevOps's explicit request, so the fix gets built against this contract
 * instead of a test getting rewritten to match whatever the fix turns out
 * to be. Posted alongside this file on #1342.
 *
 * THE CONFIRMED MECHANISM (source-read, not guessed) for the /research
 * instance named in #1342's open checklist item:
 *
 *   components/HypothesisTracker.tsx:123-128
 *     const fetchEvidence = useCallback(async (id) => {
 *       const res = await apiFetch(`/api/hypotheses/${id}/evidence`);
 *       if (!res.ok) return;                          // <- silently drops the failure
 *       const json = await res.json();
 *       setEvidenceMap(prev => ({ ...prev, [id]: json.evidence ?? [] }));
 *     }, []);
 *
 *   components/HypothesisTracker.tsx:369
 *     const evList = evidenceMap[h.id] ?? [];          // <- the collapse
 *
 * `evidenceMap[h.id]` is `undefined` in THREE cases this one line cannot
 * tell apart: never requested, still in flight, and failed. All three
 * render as "0 evidence entries" - exactly #1342's pattern ("not yet
 * known" rendered as a definite empty answer), and there is no loading or
 * error state for the evidence fetch AT ALL, unlike `fetchHypotheses`
 * (same file, lines 100-119) which already sets `hypError` on a failed
 * response rather than silently returning.
 *
 * The hypotheses LIST's own fetch (`fetchHypotheses`) was checked too and,
 * on a static read, does NOT show the same defect: `if (!user) return`
 * happens BEFORE `setLoading(true)`, so an auth-not-ready read leaves
 * `loading` at its true initial value (skeleton stays showing) rather than
 * flipping to false; `!res.ok` sets `hypError`, not an empty list. Whether
 * the list itself still renders empty under some other race (out-of-order
 * responses - `fetchHypotheses` has no requestId/AbortController guard) is
 * UNCONFIRMED - left that way rather than guessed, per PM's instruction.
 * Only the evidence-map collapse above is asserted here.
 *
 * THE PROPOSED SHARED PATTERN, for Dev to build `lib/fetchState.ts`
 * against (one shared shape, not a fifth ad-hoc guard):
 *
 *   type FetchState<T> =
 *     | { status: 'loading' }
 *     | { status: 'error'; message: string }
 *     | { status: 'ready'; data: T }
 *
 *   fetchStateFromResult(result) turns the three raw outcomes of an async
 *   read (not started yet / failed / succeeded) into exactly one of the
 *   above - the single place "not yet known" and "definitely empty" are
 *   forced to be different values instead of both defaulting to undefined
 *   or `[]`.
 *
 *   isConfirmedEmpty(state) is true ONLY for `{status:'ready', data:[]}` -
 *   the one case where rendering "no results" is actually honest. Every
 *   other state must render loading or error, never the empty-list UI.
 *
 * This file imports lib/fetchState.ts via a computed path so it SKIPS
 * cleanly (not a failure) until Dev creates that module, per this
 * project's established pattern for a fix that hasn't landed yet
 * (__tests__/calculatorDirectionality.test.mts does the same for
 * lib/riskReward.ts et al.).
 */

const libPath = (name: string) => '../lib/' + name + '.ts';
const fetchStateMod: any = await import(libPath('fetchState')).catch(() => null);
const fetchStateFromResult = fetchStateMod?.fetchStateFromResult;
const isConfirmedEmpty = fetchStateMod?.isConfirmedEmpty;

const FETCH_STATE_SKIP = fetchStateFromResult && isConfirmedEmpty
  ? false
  : 'lib/fetchState.ts does not exist yet (#1342) - this is the pattern QA is proposing Dev build against, not yet implemented';

test('fetchStateFromResult: not-yet-started reads as loading, never empty', { skip: FETCH_STATE_SKIP }, () => {
  const state = fetchStateFromResult(null);
  assert.equal(state.status, 'loading',
    'a read that has not resolved yet (no result object at all - the in-flight/not-started case) must be "loading", not "ready" with empty data');
});

test('fetchStateFromResult: a failed read reads as error, never empty', { skip: FETCH_STATE_SKIP }, () => {
  const state = fetchStateFromResult({ ok: false, message: 'Unauthorized' });
  assert.equal(state.status, 'error',
    'a failed fetch (401, network error, timeout) must be "error", not silently collapsed into an empty ready list');
  assert.equal((state as { message: string }).message, 'Unauthorized');
});

test('fetchStateFromResult: a genuinely empty successful read reads as ready with zero items', { skip: FETCH_STATE_SKIP }, () => {
  const state = fetchStateFromResult({ ok: true, data: [] });
  assert.equal(state.status, 'ready',
    'a real, successful response with zero rows must still be distinguishable from loading/error - "ready" is not "hide the section"');
  assert.deepEqual((state as { data: unknown[] }).data, []);
});

test('fetchStateFromResult: a successful read with real rows reads as ready with that data, untouched', { skip: FETCH_STATE_SKIP }, () => {
  const rows = [{ id: 'e1' }, { id: 'e2' }];
  const state = fetchStateFromResult({ ok: true, data: rows });
  assert.equal(state.status, 'ready');
  assert.deepEqual((state as { data: unknown[] }).data, rows);
});

test('isConfirmedEmpty: true only for a ready state with zero items - never for loading or error', { skip: FETCH_STATE_SKIP }, () => {
  assert.equal(isConfirmedEmpty({ status: 'loading' }), false,
    'loading must never be reported as "confirmed empty" - that is exactly the /research defect (undefined treated as 0 results)');
  assert.equal(isConfirmedEmpty({ status: 'error', message: 'x' }), false,
    'a failed read must never be reported as "confirmed empty" either - same defect, different trigger');
  assert.equal(isConfirmedEmpty({ status: 'ready', data: [] }), true,
    'the one and only state where "no results" is an honest thing to render');
  assert.equal(isConfirmedEmpty({ status: 'ready', data: [{ id: 'e1' }] }), false);
});
