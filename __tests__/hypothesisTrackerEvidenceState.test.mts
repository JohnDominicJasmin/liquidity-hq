/* #1342/#1345/#1346: HypothesisTracker's evidence fetch used to collapse "never fetched", "in flight" and
 * "failed" into the same `evidenceMap[id] ?? []` empty render. `__tests__/authTimingFetchState.test.mts`
 * (QA, #1345, written BEFORE this fix existed) already proves `lib/fetchState.ts`'s three functions are
 * correct in isolation, and now that Dev's `bb966a0f` has landed, that file's five tests run for real
 * instead of self-skipping - confirmed by re-running it against this branch (0 skipped, 5/5 pass).
 *
 * THIS FILE is the missing other half: does `components/HypothesisTracker.tsx` actually WIRE UP to that
 * module the way #1345's contract intended - `setEvidenceState` set to `loading` before the fetch, both a
 * non-ok response AND a thrown error routed through `fetchStateFromResult` into `error` (not silently kept
 * at whatever was there), the empty-state copy gated on `isConfirmedEmpty` rather than `.length === 0`
 * directly, and the retry button reachable only from the error branch. Structure only, same limit as every
 * other component file tonight - no DOM test library in this repo, and `evidenceState`/`fetchEvidence` are
 * closures with no exported function to call directly. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const source = stripComments(read('components/HypothesisTracker.tsx'));

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

test('S1. fetchEvidence sets loading BEFORE the request, so the panel never shows the previous state while a new fetch is in flight', () => {
  const loadingAt = anchorOnce(source, "setEvidenceState(prev => ({ ...prev, [id]: { status: 'loading' } }));", 'the pre-fetch loading set');
  const apiFetchAt = anchorOnce(source, 'const res = await apiFetch(`/api/hypotheses/${id}/evidence`);', 'the actual fetch call');
  assert.ok(loadingAt < apiFetchAt, 'loading is set after the fetch starts, not before - a fast response could race ahead of the loading render');
});

test('S2. a non-ok response is routed to error, not silently kept at whatever evidence (if any) already showed', () => {
  anchorOnce(source, "if (!res.ok) {\n        result = { ok: false, message: t('HYPOTHESIS_TRACKER_EVIDENCE_ERROR') };\n      } else {", 'the non-ok branch');
});

test('S3. a thrown error (network failure) is ALSO routed to error - the try/catch does not let an exception skip the error state entirely', () => {
  const at = anchorOnce(source, "} catch {\n      result = { ok: false, message: t('HYPOTHESIS_TRACKER_EVIDENCE_ERROR') };\n    }", 'the catch branch');
  assert.ok(at > 0);
});

test('S4. the final state is always produced by fetchStateFromResult, for both the success and the two failure paths - one place, not three', () => {
  anchorOnce(source, "setEvidenceState(prev => ({ ...prev, [id]: fetchStateFromResult(result) }));", 'the shared conversion call');
});

test('S5. the panel renders the error message and a retry button ONLY when status is "error", checked before the loading/ready branches', () => {
  const errAt = anchorOnce(source, "evState?.status === 'error' ? (", 'the error ternary arm');
  const retryAt = source.indexOf('onClick={() => fetchEvidence(h.id)}', errAt);
  assert.ok(retryAt > errAt && retryAt - errAt < 400, 'the retry button is not inside (or not close to) the error branch');
  const notReadyAt = anchorOnce(source, "evState?.status !== 'ready' ? (", 'the loading/not-ready ternary arm');
  assert.ok(errAt < notReadyAt, 'the error check does not come before the not-ready (loading) check - error would never be reached');
});

test('S6. the "no evidence logged yet" text is gated on isConfirmedEmpty, not a bare .length === 0 - the exact collapse this fix removes', () => {
  anchorOnce(source, '{isConfirmedEmpty(evState) ? (', 'the confirmed-empty gate');
  assert.doesNotMatch(source, /evList\.length === 0 \? \(/, 'a raw evList.length === 0 ternary still exists - the old collapse is back somewhere');
});

test('S7. evList (used for the count heading and the map below) only ever reads real data from a ready state, never from loading or error', () => {
  anchorOnce(source, "const evList = evState?.status === 'ready' ? evState.data : [];", 'the evList derivation');
});

test('S8. deleteEvidence only mutates a state that is actually "ready" - deleting against a loading/error/unknown state is a no-op, not a crash or a fabricated ready state', () => {
  anchorOnce(source,
    "setEvidenceState(prev => {\n        const cur = prev[hypothesisId];\n        if (cur?.status !== 'ready') return prev;\n        return { ...prev, [hypothesisId]: { status: 'ready', data: cur.data.filter(e => e.id !== evidenceId) } };\n      });",
    'the guarded delete');
});

test('S9. fetchEvidence is only called once per expand if evidenceState has no entry yet for that id - not on every toggle', () => {
  anchorOnce(source, 'if (!evidenceState[id]) await fetchEvidence(id);', 'the fetch-once-per-id guard');
});

/* ── labels ── */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const KEYS = ['HYPOTHESIS_TRACKER_EVIDENCE_LOADING', 'HYPOTHESIS_TRACKER_EVIDENCE_ERROR'];

test('L1. both new keys are registered and have a non-empty English default', () => {
  const keys = read('lib/labelKeys.ts');
  for (const k of KEYS) {
    assert.ok(keys.includes(`'${k}'`), `${k} is not in lib/labelKeys.ts`);
    assert.ok(typeof defaults[k] === 'string' && defaults[k].trim().length > 0, `${k} has no default text`);
  }
});

test('L2. the migration\'s live and commented-dev rows both equal the shipped default, exactly', () => {
  const sql = read('supabase/migrations/20260918a_labels_hypothesis_evidence_fetch_state.sql');
  const rows = (commented: boolean) => {
    const out: Record<string, string> = {};
    for (const raw of sql.split('\n')) {
      const line = raw.trim();
      const isCommentRow = line.startsWith("-- ('");
      const isLiveRow = line.startsWith("('");
      if (commented ? !isCommentRow : !isLiveRow) continue;
      const bare = commented ? line.slice(3) : line;
      const parts = bare.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
      if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
    }
    return out;
  };
  const live = rows(false), dev = rows(true);
  assert.deepEqual(Object.keys(live).sort(), KEYS.slice().sort(), 'the live block seeds a different key set than expected');
  assert.deepEqual(live, dev, 'the commented dev block has drifted from the live block');
  for (const k of KEYS) assert.equal(live[k], defaults[k], `${k}: migration and shipped default differ`);
});
