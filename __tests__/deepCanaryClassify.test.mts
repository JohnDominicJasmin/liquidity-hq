/* The Deep canary's classification table (#1631, PR #2063).
 *
 * `classifyDeepResponse` decides whether a Deep read was healthy, degrading, broken, or simply never
 * measured. Everything the canary reports — issues opened, issues closed, the owner's attention —
 * hangs off that one function, and the whole value of the canary is that it is RIGHT about which of
 * the four it is. So the table gets a committed test rather than a one-off run.
 *
 * ── THE SPLIT THE TABLE EXISTS TO PROTECT ───────────────────────────────────────────────────────
 *
 *   UNKNOWN   we never got to ask            quota, sleeping service, stale credential, bad plan read
 *   FAIL      Deep answered unusably, or our own request was refused
 *   DEGRADED  Deep answered, parsed, and was billed TWICE via the restate pass
 *   OK        a clean first-time parse — the ONLY state that closes the issue
 *
 * DEGRADED is the state QA's review of the first version added. A repaired read returns HTTP 200
 * with a real signal and a real confidence, so the original classifier saw a satisfied contract and
 * said OK — while the model had stopped answering in the required form and the customer was being
 * billed twice. A canary reporting health while the thing it watches rots is the exact failure class
 * it exists to catch.
 *
 * ── WHY THE CONTROLS MATTER MORE THAN THE ROWS ──────────────────────────────────────────────────
 *
 * A classifier that answered UNKNOWN to everything satisfies 4 rows. One that answered FAIL to
 * everything satisfies 7. And the specific wrong version this feature invites — "make the canary
 * notice result.checks" implemented as "degrade if checks is non-empty" — still passes 13 of the 14
 * state rows, because content judgements are rare in fixtures and common in life. C2 is the row that
 * refuses it, and it is the one to keep if anything is ever dropped from this file.
 *
 * NO NETWORK, NO SPEND: the function is pure and takes the response as data. Importing the script is
 * itself a guard — before #2063's `pathToFileURL` main guard, importing it RAN the canary and called
 * `process.exit()`, killing the test before a single assertion. A suite that exits 0 having checked
 * nothing. If that regresses, this file stops running rather than passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeepResponse } from '../scripts/deep-canary.mjs';
import { VERDICT_RESTATED_CHECK } from '../lib/grok.ts';

/** A response body that satisfies the contract, so each row can vary ONE thing from healthy. */
const okJson = (over: Record<string, unknown> = {}) => ({
  result: { signal: 'LEAN BEARISH', confidence: 60, ...over },
  usage: { deep_used: 1, deep_limit: 10 },
});
const state = (args: Record<string, unknown>) => (classifyDeepResponse(args as never) as { state: string }).state;

/* A real content judgement from applyResultChecks (lib/grok.ts), not an invention of this test. */
const CONTENT_CHECK = 'raid dropped: no liquidation cluster data';

test('D1. "we never got to ask" is UNKNOWN, never a failure', () => {
  assert.equal(state({ status: 429 }), 'UNKNOWN', 'exhausted quota means no read was made');
  assert.equal(state({ status: 429, code: 'RATE_LIMIT' }), 'UNKNOWN');
  assert.equal(state({ status: 503, code: 'PLAN_UNKNOWN' }), 'UNKNOWN', 'the plan read failed before Deep was reached');
  assert.equal(state({ status: 401 }), 'UNKNOWN');
  assert.equal(state({ status: 403 }), 'UNKNOWN');
});

test('D2. our own request being refused is a FAIL - the canary is measuring nothing until fixed', () => {
  assert.equal(state({ status: 400 }), 'FAIL');
  assert.equal(state({ status: 400, code: 'BAD_REQUEST' }), 'FAIL');
});

test('D3. 502 BAD_ANSWER is the failure the canary was built for', () => {
  assert.equal(state({ status: 502, code: 'BAD_ANSWER' }), 'FAIL');
});

test('D4. a 503 or 502 WITHOUT its special code is still a FAIL, not an UNKNOWN', () => {
  /* The two UNKNOWN carve-outs are keyed on the CODE, not the status. A 503 that is not
     PLAN_UNKNOWN is the service failing, which is Deep not answering - and must not inherit the
     "not a Deep failure" exemption just because it shares a status line with it. */
  assert.equal(state({ status: 503 }), 'FAIL');
  assert.equal(state({ status: 503, code: 'SOMETHING_ELSE' }), 'FAIL');
  assert.equal(state({ status: 502 }), 'FAIL');
  assert.equal(state({ status: 502, code: 'UNDRAWABLE' }), 'FAIL');
  assert.equal(state({ status: 500 }), 'FAIL');
});

test('D5. HTTP 200 that does not satisfy the contract is a FAIL', () => {
  assert.equal(state({ status: 200, json: null }), 'FAIL', 'no body');
  assert.equal(state({ status: 200, json: {} }), 'FAIL', 'no result object');
  assert.equal(state({ status: 200, json: { result: 'BULLISH' } }), 'FAIL', 'result must be an object, not a string');
  assert.equal(state({ status: 200, json: okJson({ signal: 'VERY BULLISH' }) }), 'FAIL', 'signal outside the five');
  assert.equal(state({ status: 200, json: okJson({ signal: null }) }), 'FAIL');
  assert.equal(state({ status: 200, json: okJson({ confidence: '60' }) }), 'FAIL', 'confidence must be a number, not a numeric string');
  assert.equal(state({ status: 200, json: okJson({ confidence: NaN }) }), 'FAIL', 'NaN is a number but not a finite one');
  assert.equal(state({ status: 200, json: okJson({ confidence: -1 }) }), 'FAIL');
  assert.equal(state({ status: 200, json: okJson({ confidence: 101 }) }), 'FAIL');
});

test('D6. all five signals and the confidence BOUNDARIES are accepted', () => {
  for (const signal of ['BULLISH', 'LEAN BULLISH', 'FLAT', 'LEAN BEARISH', 'BEARISH']) {
    assert.equal(state({ status: 200, json: okJson({ signal }) }), 'OK', `${signal} is one of the five and must pass`);
  }
  /* 0 and 100 are inclusive. A `<= 0` or `>= 100` slip would turn a legitimate extreme into a FAIL
     and the canary would alarm on a correct read. */
  assert.equal(state({ status: 200, json: okJson({ confidence: 0 }) }), 'OK', 'zero confidence is a real answer');
  assert.equal(state({ status: 200, json: okJson({ confidence: 100 }) }), 'OK', 'full confidence is a real answer');
});

test('D7. a clean first-time parse is OK - the only state that closes the issue', () => {
  assert.equal(state({ status: 200, json: okJson() }), 'OK');
  assert.equal(state({ status: 200, json: okJson({ checks: [] }) }), 'OK', 'an empty checks array is a clean read');
  assert.equal(state({ status: 200, json: okJson({ checks: 'not-an-array' }) }), 'OK', 'a malformed checks field must not be read as degraded');
  assert.equal(state({ status: 200, json: okJson({ checks: [1, 2, null] }) }), 'OK', 'non-string entries are filtered, not treated as markers');
});

test('D8. a read that only parsed AFTER the restate pass is DEGRADED, not OK', () => {
  /* The gap QA found in the first version: this returns 200 with a valid signal and confidence, so
     every contract row above passes and the old classifier said OK - while the model had stopped
     answering in the required form and the read was billed twice. */
  assert.equal(state({ status: 200, json: okJson({ checks: [VERDICT_RESTATED_CHECK] }) }), 'DEGRADED');
  assert.equal(
    state({ status: 200, json: okJson({ checks: [CONTENT_CHECK, VERDICT_RESTATED_CHECK] }) }),
    'DEGRADED',
    'the marker degrades even when content judgements sit beside it',
  );
});

/* ── CONTROLS ───────────────────────────────────────────────────────────────────────────────────
 * The rows above are satisfiable by several WRONG classifiers. These refuse them. */

test('C1. CONTROL: the table produces all four states, so no blanket answer satisfies it', () => {
  /* A classifier answering UNKNOWN to everything satisfies D1; one answering FAIL to everything
     satisfies D2-D5. Requiring all four states to appear is what makes the rows above a table
     rather than a list. */
  const produced = new Set([
    state({ status: 429 }),
    state({ status: 400 }),
    state({ status: 200, json: okJson() }),
    state({ status: 200, json: okJson({ checks: [VERDICT_RESTATED_CHECK] }) }),
  ]);
  assert.deepEqual([...produced].sort(), ['DEGRADED', 'FAIL', 'OK', 'UNKNOWN'],
    'the four states are not all reachable - a classifier that collapses two of them would pass most rows above');
});

test('C2. CONTROL: CONTENT checks alone must NOT degrade - the one to keep if any is dropped', () => {
  /* `result.checks` carries applyResultChecks' content judgements as well as the restate marker:
     tier-vs-counted mismatches, "raid dropped: no liquidation cluster data", "perps-vs-spot
     disclosure added". Those depend on what the model said and what data existed that minute.
     Alarming on them makes the canary fire at random, and a canary that cries wolf gets muted -
     which costs more than the bug it was built for.
     The obvious wrong implementation of "notice result.checks" is `checks.length > 0`, and it still
     passes 13 of the 14 state rows above. This row is what refuses it. */
  assert.equal(state({ status: 200, json: okJson({ checks: [CONTENT_CHECK] }) }), 'OK');
  assert.equal(
    state({ status: 200, json: okJson({ checks: [CONTENT_CHECK, 'perps-vs-spot disclosure added', 'tier lowered to match the counted signals'] }) }),
    'OK',
    'three content judgements and no restate marker is still a clean read',
  );
});

test('C3. CONTROL: the marker is matched EXACTLY, not by a loose pattern', () => {
  /* If detection were a substring or /restated/i test, a content judgement that happened to use the
     word would degrade a healthy read. Near-misses must not fire. */
  for (const near of [
    'verdict restated',
    'the verdict was restated by a second pass',
    VERDICT_RESTATED_CHECK.toUpperCase(),
    VERDICT_RESTATED_CHECK.slice(0, -1),
    ` ${VERDICT_RESTATED_CHECK}`,
  ]) {
    assert.equal(state({ status: 200, json: okJson({ checks: [near] }) }), 'OK',
      `a near-miss string degraded the read: ${JSON.stringify(near)} - detection is matching loosely, so content wording can trigger a false alarm`);
  }
});

test('C4. CONTROL: the marker is the SHARED constant, not a copy inside the canary', () => {
  /* The canary imports VERDICT_RESTATED_CHECK from lib/grok.ts, which is also what
     app/api/grok/route.ts pushes. If the canary ever carried its own copy, rewording the route's
     string would silently stop degraded reads being noticed while the canary kept reporting OK -
     the same failure shape as the bug, one level up.
     This asserts the coupling behaviourally: the value imported from lib/grok is the value that
     triggers DEGRADED. A divergent copy inside the script fails this. */
  assert.equal(typeof VERDICT_RESTATED_CHECK, 'string');
  assert.ok(VERDICT_RESTATED_CHECK.length > 0, 'the shared marker is empty, which would make every checks entry match or none');
  assert.equal(state({ status: 200, json: okJson({ checks: [VERDICT_RESTATED_CHECK] }) }), 'DEGRADED',
    'the constant exported by lib/grok.ts does not trigger DEGRADED - the canary is keyed off a different string than the route writes');
});

test('C5. CONTROL: a valid signal does not excuse a bad confidence, and vice versa', () => {
  /* Both halves of the contract are required. A classifier checking only one would pass D6 and D7. */
  assert.equal(state({ status: 200, json: okJson({ confidence: 'high' }) }), 'FAIL', 'valid signal, bad confidence');
  assert.equal(state({ status: 200, json: okJson({ signal: 'SIDEWAYS' }) }), 'FAIL', 'bad signal, valid confidence');
});
