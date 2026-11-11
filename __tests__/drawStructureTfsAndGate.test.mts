import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRAW_STRUCTURE_TFS,
  DRAW_STRUCTURE_NOISY_TFS,
  drawStructureAvailable,
} from '../lib/drawStructure.ts';

/* Coverage for #2108 - Draw Structure on 1h and 2h, locked for Free, no Keep/Discard.
 *
 * QA owns every test (owner ruling 2026-09-07), so this is written here rather than beside the
 * feature. Node-level wherever the thing under test is importable: the timeframe list and
 * `drawStructureAvailable` are plain exports from `lib/drawStructure.ts`, so D1-D3 call them for
 * real. The gate and the persistence rule live inside a React component that cannot mount under
 * `node --test`, so D4-D6 assert the SOURCE SHAPE and say so in their own messages - a source
 * assertion is weaker than exercising the component and should not be read as the same thing.
 *
 * EVERY CELL CARRIES ITS PRE-FIX CONTROL, per PM's instruction. A guard that passes on the fixed
 * code proves nothing on its own: the same guard has to REJECT the code as it was before the fix,
 * or it is not testing the fix. The pre-fix fixtures are the real old shapes, quoted from the
 * diffs, embedded as strings so these cells need no git history at runtime.
 */

const KLINE_SRC = readFileSync('components/KLineProChart.tsx', 'utf8');

/** The body of a named function or arrow-const, from its declaration to a rough end. Deliberately
 *  crude - it is used only to scope a `includes` check to one function, and every cell that uses it
 *  also asserts the slice was actually found. */
function sliceFrom(src: string, needle: string, chars = 3000): string {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `could not find ${JSON.stringify(needle)} in the source, so the slice below would be empty`);
  return src.slice(at, at + chars);
}

/** Text BETWEEN two markers, for the cases where a fixed character count is the wrong boundary.
 *
 *  D5 originally used `sliceFrom(..., 1800)` and failed: the locked branch and the unlocked branch
 *  are about thirty lines apart, so 1800 characters ran past the first into the second - which
 *  legitimately DOES call `requestStructures`. The guard was wrong, not the component. Worth the
 *  extra helper rather than a bigger magic number, because "how many characters is this JSX branch"
 *  is not a fact any reader can check, while "up to where the next branch starts" is. */
function sliceBetween(src: string, startNeedle: string, endNeedle: string): string {
  const from = src.indexOf(startNeedle);
  assert.ok(from >= 0, `could not find start marker ${JSON.stringify(startNeedle)}`);
  const to = src.indexOf(endNeedle, from + startNeedle.length);
  assert.ok(to > from, `could not find end marker ${JSON.stringify(endNeedle)} after the start marker`);
  return src.slice(from, to);
}

test('D1. the offered timeframes are exactly 1h, 2h, 4h and 1d', () => {
  assert.deepEqual([...DRAW_STRUCTURE_TFS].sort(), ['1d', '1h', '2h', '4h'],
    'the offered timeframe list changed; 15m and 30m are a deliberate HOLD pending a blind owner review, not an oversight');
  /* Length asserted separately from the set, so ADDING a timeframe fails even if the four are
     still present - a set comparison alone would pass a list of five containing these four. */
  assert.equal(DRAW_STRUCTURE_TFS.length, 4, 'a timeframe was added or removed');
});

test('D2. the button is offered on those four and on nothing else - 15m and 30m stay out', () => {
  for (const tf of ['1h', '2h', '4h', '1d']) {
    assert.equal(drawStructureAvailable(tf), true, `${tf} should be offered`);
  }
  /* 15m and 30m first because they are the held pair this feature deliberately excludes; the rest
     guard against a list that accidentally matches everything. */
  for (const tf of ['15m', '30m', '1m', '5m', '1w', '3d', '', 'h1', '4H']) {
    assert.equal(drawStructureAvailable(tf), false, `${tf} must NOT be offered`);
  }
});

test('D3. every noisy timeframe is one of the offered ones, and the held pair is in neither list', () => {
  /* THE COMMENT ON THIS CONSTANT CLAIMS A PROPERTY THE CODE DOES NOT HAVE.
     `lib/drawStructure.ts:159` says the noisy list is "Derived from the list above rather than
     written out twice, so adding a timeframe cannot forget the note" - and line 161 writes it out
     twice as its own literal. So the protection the comment promises does not exist: adding '30m'
     to DRAW_STRUCTURE_TFS would not add it here.
     Reported to Dev as a finding, and BE PRECISE ABOUT WHAT THIS CELL REPLACES, because it is not
     the whole of it. These assertions fail when the noisy list contains an unoffered timeframe, and
     when either list gains 15m or 30m. Together with D1's length check that covers every change to
     the offered list made today. What no assertion here can do is decide whether a FUTURE
     timeframe - say '6h' - ought to carry the note: only a real derivation knows that. So this
     cell is a tripwire that forces a human to come and look, not a substitute for deriving the
     list, and the finding stands on that basis. */
  for (const tf of DRAW_STRUCTURE_NOISY_TFS) {
    assert.ok((DRAW_STRUCTURE_TFS as readonly string[]).includes(tf),
      `'${tf}' carries the more-noise note but is not an offered timeframe - the two lists have drifted, `
      + 'which is exactly what the "derived" comment says cannot happen');
  }
  for (const tf of ['15m', '30m']) {
    assert.ok(!DRAW_STRUCTURE_NOISY_TFS.includes(tf), `${tf} must not carry the note while it is not offered`);
    assert.ok(!(DRAW_STRUCTURE_TFS as readonly string[]).includes(tf), `${tf} must not be offered`);
  }

  // CONTROL: the subset check above must actually reject a drifted pair, not merely pass on today's.
  const drifted = ['1h', '30m'];
  const offered: readonly string[] = ['1h', '2h', '4h', '1d'];
  assert.ok(drifted.some(tf => !offered.includes(tf)),
    'CONTROL FAILED: the subset logic would accept a noisy list containing an unoffered timeframe');
});

test('D4. only a CONFIRMED Free account is locked - unknown keeps today behaviour', () => {
  const locked   = "drawStructureAvailable(tf) && entitlementStatus === 'not_entitled' && onUnlock";
  const unlocked = "drawStructureAvailable(tf) && entitlementStatus !== 'not_entitled'";

  assert.ok(KLINE_SRC.includes(locked), 'the locked branch no longer gates on entitlementStatus === not_entitled');
  assert.ok(KLINE_SRC.includes(unlocked),
    'the unlocked branch must gate on !== not_entitled, so that `unknown` - every entitlement retry '
    + 'having failed - falls through to the ordinary panel rather than being locked out');

  /* The two conditions are complementary on `not_entitled`, which is what makes `unknown` safe.
     Asserting both strings is the point: a change to either one alone breaks the pairing, and
     locking `unknown` would mean locking out a paying user whose entitlement read merely failed. */
  assert.ok(!KLINE_SRC.includes("entitlementStatus === 'unknown' && onUnlock"),
    'unknown must never reach the locked branch');

  // CONTROL: pre-#2108 source had no locked branch at all. The guard must reject that.
  const preFix = "{drawStructureAvailable(tf) && (\n  <button onClick={requestStructures}>Draw</button>\n)}";
  assert.ok(!preFix.includes(locked),
    'CONTROL FAILED: the locked-branch guard would have passed on the pre-fix source');
});

test('D5. the locked button calls onUnlock and cannot reach /api/draw-structure', () => {
  /* Bounded by where the UNLOCKED branch begins, not by a character count - see sliceBetween. */
  const branch = sliceBetween(
    KLINE_SRC,
    "entitlementStatus === 'not_entitled' && onUnlock",
    "entitlementStatus !== 'not_entitled'",
  );

  assert.ok(branch.includes('onClick={onUnlock}'), 'the locked button must call onUnlock');

  /* WIRED OR CALLED, not "the word appears". The first version asserted
     `!branch.includes('requestStructures')` and failed - on a COMMENT in that very branch reading
     "NEVER `requestStructures` ON THIS BRANCH". The guard was reading prose as code, and the most
     ironic possible false positive: the comment documenting the rule tripped the check enforcing
     it. What matters is whether the identifier is HANDLER-WIRED or INVOKED, so assert that. */
  assert.ok(!branch.includes('onClick={requestStructures}'),
    'the locked button is wired to requestStructures, the only caller of /api/draw-structure');
  assert.ok(!/requestStructures\s*\(/.test(branch),
    'the locked branch invokes requestStructures, which would spend a draw-structure call for a Free visitor');

  /* The fetch exists exactly once and lives in requestStructures, so "the locked button never
     spends a draw-structure call" reduces to "the locked branch does not call requestStructures".
     STATED LIMIT: this is a source-shape argument. It does not prove the component never reaches
     the fetch by some other route at runtime - only that the locked branch has no path to the one
     function that performs it. Exercising that needs a browser, which is on hold. */
  const fetchSites = KLINE_SRC.split("fetch('/api/draw-structure'").length - 1;
  assert.equal(fetchSites, 1, 'more than one draw-structure fetch site; the reduction above no longer holds');
  assert.ok(sliceFrom(KLINE_SRC, 'const requestStructures', 2500).includes("fetch('/api/draw-structure'"),
    'the draw-structure fetch is no longer inside requestStructures');

  // CONTROL: a locked branch that wired the real action instead of onUnlock must be rejected.
  const wrong = "entitlementStatus === 'not_entitled' && onUnlock && (<button onClick={requestStructures} />)";
  assert.ok(wrong.includes('requestStructures'),
    'CONTROL FAILED: this cell would not notice a locked button wired to the paid action');
});

test('D6. model lines cannot reach the persisted drawing group', () => {
  /* The whole point of #2108's rework: proposals live in their own group that `saveDrawings` does
     not read, so a model-drawn line can never become part of the user's saved drawings. Before the
     fix an Accept button PROMOTED a proposal into DRAWING_GROUP - which is the shape the control
     below rejects. */
  assert.ok(KLINE_SRC.includes("const DRAWING_GROUP = 'user_drawing'"), 'DRAWING_GROUP renamed or gone');
  assert.ok(KLINE_SRC.includes("const PROPOSAL_GROUP = 'structure_proposals'"), 'PROPOSAL_GROUP renamed or gone');

  const save = sliceFrom(KLINE_SRC, 'function saveDrawings', 600);
  assert.ok(save.includes('groupId: DRAWING_GROUP'), 'saveDrawings no longer reads DRAWING_GROUP');
  assert.ok(!save.includes('PROPOSAL_GROUP'),
    'saveDrawings must not read the proposal group, or model lines would be persisted');

  const request = sliceFrom(KLINE_SRC, 'const requestStructures', 2500);
  assert.ok(request.includes('groupId: PROPOSAL_GROUP'), 'proposals are no longer created in PROPOSAL_GROUP');
  assert.ok(!request.includes('DRAWING_GROUP'),
    'the proposal path references DRAWING_GROUP - a model line can reach the persisted store');

  // CONTROL: the pre-fix promotion shape must be rejected by the check above.
  const preFix = "const requestStructures = async () => { chart.createOverlay({ groupId: DRAWING_GROUP }); }";
  assert.ok(preFix.includes('DRAWING_GROUP'),
    'CONTROL FAILED: this cell would not notice a proposal being created in the persisted group');
});
