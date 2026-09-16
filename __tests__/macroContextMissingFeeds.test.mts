import test from 'node:test';
import assert from 'node:assert/strict';

/* Antislop audit 001 (#1309) item 11 (AS-D) - when 1 or 2 of the 5 macro
 * feeds (DXY, VIX, Gold, Oil, 10Y Treasury) fail, app/api/macro-context/
 * route.ts:186-190 falls back to hardcoded stand-in values (DXY 103.5, VIX
 * 18, gold 2350, oil 78, 10Y 4.3%) and returns them in the payload
 * INDISTINGUISHABLE from a real reading - both to the dashboard/research
 * panel AND to the prompt sent to the AI for analysis. `missingData` IS
 * already returned alongside (route.ts:221), but
 * components/GlobalMacroContext.tsx never reads it, so the fake numbers
 * render as if live either way.
 *
 * WRITTEN BEFORE THE FIX, per PM/DevOps - confirmed RED against the
 * current route logic, not run yet.
 *
 * THIS IMPORT DOES NOT EXIST YET. The whole feeds-in -> payload-out
 * decision (lines 174-199 of route.ts today) is inline in the route
 * handler, mixed in with auth, rate-limiting and the actual xAI call - none
 * of which this test needs or wants to exercise. What's needed is exactly
 * the same shape as lib/alertCooldown.ts's own extraction: a pure function
 * taking the five fetch results (each real data or null) and returning the
 * payload, testable with zero network access.
 *
 *   lib/macroContext.ts
 *     export function buildMacroPayload(
 *       dxyData:  { price: number; prev: number } | null,
 *       vixData:  { price: number; prev: number } | null,
 *       goldData: { price: number; prev: number } | null,
 *       oilData:  { price: number; prev: number } | null,
 *       tnxData:  { price: number; prev: number } | null,
 *     ): {
 *       payload: {
 *         dxy: number | null; dxyChg: number | null;
 *         vix: number | null; vixChg: number | null;
 *         gold: number | null; goldChg: number | null;
 *         oil: number | null; oilChg: number | null;
 *         tnx: number | null; tnxChg: number | null;
 *         goldOilRatio: number | null;   // null if either side of the ratio is missing
 *       };
 *       missingData: string[];           // unchanged shape from today's `missing`
 *       tooManyMissing: boolean;         // today's `missing.length >= 3` throw condition,
 *                                        // surfaced as a return value instead of an
 *                                        // exception, so this function stays pure
 *     }
 *
 * Route.ts then calls this, throws when tooManyMissing is true (preserving
 * today's ">=3 missing -> hard error" behavior unchanged), and passes
 * payload+missingData straight through to both the AI prompt and the JSON
 * response, exactly as now.
 *
 * WHY null (not "unavailable" as a string) FOR THE PER-FIELD VALUES. A
 * string in a field every other branch treats as a number would need a
 * type check at every single consumer (the prompt builder, the panel, any
 * arithmetic using it) to avoid a silent NaN - GlobalMacroContext.tsx
 * already has to check `missingData` at all, once, to gate rendering; null
 * plus that one check is the shape that can't be used by accident. Exact
 * naming/shape is QA's proposal - the CONTRACT below (no invented number
 * ever appears, missingData always names what's actually missing) is what
 * this test needs to hold.
 */

/* Dynamic + computed specifier, not a static import: lib/macroContext.ts
 * doesn't exist yet (see the header above). A static import that fails to
 * resolve crashes the whole process before a single test can register,
 * which would fail __tests__/*.test.mts's own automatic run in the
 * pre-push gate for EVERY push, by everyone, until Dev's extraction lands -
 * not just report this one suite red. A COMPUTED specifier (concatenation,
 * not a literal) also keeps tsc from trying to resolve the module for
 * typecheck, which it does for a dynamic import() the same as a static one
 * when the argument is a literal. This is dormant (skipped, not broken)
 * until the module shows up, and asserts for real the moment it does - no
 * further change needed here then. */
const libPath = (name: string) => '../lib/' + name + '.ts';
const macroContext: any = await import(libPath('macroContext')).catch(() => null);
const buildMacroPayload = macroContext?.buildMacroPayload;
const SKIP = buildMacroPayload ? false : 'lib/macroContext.ts does not exist yet - see this file\'s header for what to extract';

const REAL = { price: 100, prev: 99 };
const INVENTED_VALUES = [103.5, 18, 2350, 78, 4.3]; // route.ts:186-190's exact stand-ins

test('buildMacroPayload: a missing feed must never surface as an invented number', { skip: SKIP }, async (t) => {
  await t.test('1 feed missing (DXY): dxy is null, not 103.5 - the other four are untouched', () => {
    const { payload, missingData } = buildMacroPayload(null, REAL, REAL, REAL, REAL);
    assert.equal(payload.dxy, null, `dxy was ${payload.dxy} - a missing feed must be null, never an invented reading`);
    assert.ok(!INVENTED_VALUES.includes(payload.dxy as number), 'dxy must not be the old hardcoded stand-in');
    assert.deepEqual(missingData, ['DXY']);
    assert.equal(payload.vix, REAL.price, 'a feed that DID succeed must still report its real value');
  });

  await t.test('2 feeds missing (VIX, Oil): both null, both named in missingData, request still succeeds', () => {
    const { payload, missingData, tooManyMissing } = buildMacroPayload(REAL, null, REAL, null, REAL);
    assert.equal(tooManyMissing, false, '2 of 5 missing must not trip the hard-failure threshold');
    assert.equal(payload.vix, null);
    assert.equal(payload.oil, null);
    assert.deepEqual([...missingData].sort(), ['Oil', 'VIX']);
    assert.equal(payload.dxy, REAL.price);
    assert.equal(payload.gold, REAL.price);
    assert.equal(payload.tnx, REAL.price);
  });

  await t.test("goldOilRatio must not be computed from an invented gold or oil value", () => {
    const { payload } = buildMacroPayload(REAL, REAL, null, REAL, REAL); // gold missing
    assert.equal(payload.goldOilRatio, null,
      `goldOilRatio was ${payload.goldOilRatio} - a ratio with an invented numerator is a second invented number, not a real one`);
  });

  await t.test('3+ feeds missing still trips tooManyMissing, unchanged from today\'s throw threshold', () => {
    const { tooManyMissing, missingData } = buildMacroPayload(null, null, null, REAL, REAL);
    assert.equal(tooManyMissing, true);
    assert.equal(missingData.length, 3);
  });

  await t.test('sanity: all 5 feeds present - every value is real, missingData is empty', () => {
    const { payload, missingData, tooManyMissing } = buildMacroPayload(REAL, REAL, REAL, REAL, REAL);
    assert.equal(tooManyMissing, false);
    assert.deepEqual(missingData, []);
    assert.equal(payload.dxy, REAL.price);
    assert.equal(payload.goldOilRatio, REAL.price / REAL.price);
  });
});
