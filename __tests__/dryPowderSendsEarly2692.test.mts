import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2692 (QA L103, #1651 comment 7018220432: the dry-powder request left 2.1-4.9 s after navigation because it waited for the entitlement). Written rule (PR body + PM): the card sends its read AS SOON AS AUTH IS KNOWN, without waiting for the plan; the server answers 403 PRO_REQUIRED to a non-Pro account and the card turns that into its LOCKED state; a CONFIRMED non-Pro or unknown plan (entitlements loaded) still does not fetch; the read is sent ONCE per mount.
 *   E1 the gate on the full truth table (auth loading x entitlements loading x status x already started)   E2 the 403 PRO_REQUIRED answer still becomes the locked state, and a signed-out visitor still gets the unauth state without a read
 * The REAL three gate lines are cut out of components/DryPowder.tsx and run. NOT covered (browser cell after deploy): the measured time to figures (L103 re-measure). */
const src = readFileSync(new URL('../components/DryPowder.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const gate = (() => { const m = /(if \(authLoading\) return;\s*if \([^\n]*\) return;\s*if \(startedRef\.current\) return;)\s*startedRef\.current = true;/.exec(src); assert.ok(m, 'CONTROL: the effect gate was not found'); return m![1]; })();
const decide = new Function('authLoading', 'entitlementsLoading', 'entitlementStatus', 'startedRef', `${gate} startedRef.current = true; return 'fetch';`) as (a: boolean, e: boolean, s: string, r: { current: boolean }) => string | undefined;
const ruled = (authLoading: boolean, entitlementsLoading: boolean, status: string, started: boolean): 'fetch' | undefined => (authLoading ? undefined : !entitlementsLoading && status !== 'entitled' ? undefined : started ? undefined : 'fetch');

test('E1. the read goes out as soon as auth is known, with the plan still loading; never for a confirmed non-Pro or unknown plan, never twice', () => {
  let rows = 0;
  for (const authLoading of [true, false]) for (const entitlementsLoading of [true, false]) for (const status of ['entitled', 'not_entitled', 'unknown']) for (const started of [false, true]) {
    const ref = { current: started }; const got = decide(authLoading, entitlementsLoading, status, ref); rows++;
    assert.equal(got, ruled(authLoading, entitlementsLoading, status, started), JSON.stringify({ authLoading, entitlementsLoading, status, started }));
    if (got === 'fetch') assert.equal(ref.current, true, 'the once-per-mount flag must be set when the read is sent'); else assert.equal(ref.current, started, 'a skipped run must not set the flag (a later plan answer can still start it)');
  }
  assert.equal(rows, 24);
  assert.equal(decide(false, true, 'not_entitled', { current: false }), 'fetch', 'THE POINT: with the plan still loading the read is already sent'); assert.equal(decide(true, true, 'entitled', { current: false }), undefined, 'but never while auth itself is unresolved');
  /* a sequence as the page lives it: loading -> plan resolves Pro: exactly one read; loading -> resolves Free: the read was sent once and then nothing more */
  const ref = { current: false }; const seq = [[true, true, 'not_entitled'], [false, true, 'not_entitled'], [false, false, 'entitled'], [false, false, 'entitled']] as const; assert.deepEqual(seq.map(([a, e, s]) => decide(a, e, s, ref)), [undefined, 'fetch', undefined, undefined]);
  const ref2 = { current: false }; assert.deepEqual([[true, true, 'not_entitled'], [false, true, 'not_entitled'], [false, false, 'not_entitled']].map(([a, e, s]) => decide(a as boolean, e as boolean, s as string, ref2)), [undefined, 'fetch', undefined]);
  const ref3 = { current: false }; assert.deepEqual([[false, false, 'not_entitled'], [false, false, 'unknown']].map(([a, e, s]) => decide(a as boolean, e as boolean, s as string, ref3)), [undefined, undefined], 'a signed-out or confirmed Free visitor never sends it');
});
test('E2. a 403 PRO_REQUIRED answer is the locked state and a missing token is the unauth state without a read', () => {
  assert.match(src, /if \(res\.status === 403 && json\.error === 'PRO_REQUIRED'\) \{ setState\('locked'\); return; \}/, 'the 403 no longer becomes the locked card (a Free visitor whose plan was still loading would see a failure or nothing)');
  assert.match(src, /if \(!token\) \{ setState\('unauth'\); return; \}/, 'a visitor with no token must be unauth, not an error');
  const tokenAt = src.indexOf("if (!token) { setState('unauth'); return; }"), fetchAt = src.indexOf("fetch('/api/dry-powder?part=numbers'"); assert.ok(tokenAt > 0 && fetchAt > tokenAt, 'the unauth return must come BEFORE the first request');
});
