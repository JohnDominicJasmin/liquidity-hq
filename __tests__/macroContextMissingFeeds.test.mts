import test from 'node:test';
import assert from 'node:assert/strict';

/* Antislop audit 001 (#1309) item 11 (AS-D) - when 1 or 2 of the 5 macro
 * feeds (DXY, VIX, Gold, Oil, 10Y Treasury) fail, the AI-facing prompt must
 * not contain an invented number for the ones that failed.
 *
 * UPDATED after Dev's actual fix landed (fix/audit-batch-d-macro-panel-no-
 * fabrication, commit 3861c89) - this file originally proposed a new
 * lib/macroContext.ts with a buildMacroPayload() function. Dev fixed this
 * differently: app/api/macro-context/route.ts's existing buildMacroPrompt()
 * now takes each metric as `{ price, chg } | null` and lists a failed one
 * under "UNAVAILABLE (... do not assume a value or invent one)" instead of
 * substituting a hardcoded stand-in - which is exactly the CONTRACT this
 * test needs, just built as a different function than QA proposed. Rewritten
 * to match what Dev actually built rather than keep testing a function that
 * no longer matches the real fix shape.
 *
 * THIS IMPORT STILL DOES NOT EXIST YET, for a narrower reason than before:
 * `buildMacroPrompt` (and the `pctChange` helper it calls) are ALREADY pure
 * and dependency-free in route.ts - no Next.js/Supabase imports needed for
 * their own logic - but neither is exported, and the route FILE ITSELF
 * imports `next/server`, `@supabase/supabase-js`, `@/lib/xai` etc. Importing
 * the route file directly from a plain `node --test` context (no Next.js
 * runtime) risks pulling in code that doesn't resolve cleanly outside it.
 *
 * WHAT'S NEEDED, and it's a pure relocation now, not new logic (Dev already
 * wrote the correct version - this only asks it to move and gain `export`):
 *
 *   lib/macroContext.ts
 *     export function pctChange(price: number, prev: number): number   // unchanged, move as-is
 *     export function buildMacroPrompt(d: {
 *       dxy: { price: number; chg: number } | null;
 *       vix: { price: number; chg: number } | null;
 *       gold: { price: number; chg: number } | null;
 *       oil: { price: number; chg: number } | null;
 *       tnx: { price: number; chg: number } | null;
 *       goldOilRatio: number | null;
 *     }): string   // unchanged, move as-is
 *
 *   route.ts imports both back from there instead of defining them locally.
 *
 * Exact name/path is QA's proposal, not a requirement - the CONTRACT below
 * (no invented number ever appears in the prompt, a missing feed is named
 * under UNAVAILABLE) is what this test needs to hold.
 */

const libPath = (name: string) => '../lib/' + name + '.ts';
const macroContext: any = await import(libPath('macroContext')).catch(() => null);
const buildMacroPrompt = macroContext?.buildMacroPrompt;
const SKIP = buildMacroPrompt ? false : 'lib/macroContext.ts does not exist yet - see this file\'s header for what to move there';

const REAL = { price: 100, chg: 1.5 };
// route.ts's exact pre-fix stand-ins (103.5, 18, 2350, 78, 4.3) - the CI
// commit before the fix, bb7acc3, used these literal fallbacks with no
// UNAVAILABLE note at all.
const INVENTED = { dxy: 103.5, vix: 18, gold: 2350, oil: 78, tnx: 4.3 };

test('buildMacroPrompt: a missing feed must appear as UNAVAILABLE, never as an invented number', { skip: SKIP }, async (t) => {
  await t.test('1 feed missing (DXY): prompt lists DXY under UNAVAILABLE, not as a reading', () => {
    const prompt = buildMacroPrompt({ dxy: null, vix: REAL, gold: REAL, oil: REAL, tnx: REAL, goldOilRatio: 1 });
    assert.ok(prompt.includes('UNAVAILABLE'), 'prompt never mentions UNAVAILABLE for a missing feed');
    assert.ok(prompt.includes('DXY'), 'prompt does not name DXY as the missing feed');
    assert.ok(!prompt.includes(String(INVENTED.dxy)),
      `prompt contains "${INVENTED.dxy}" - the old hardcoded DXY stand-in - even though DXY's fetch failed`);
    assert.ok(!/DXY.*:\s*\d/.test(prompt.split('UNAVAILABLE')[0]),
      'a numeric reading line for DXY appears before the UNAVAILABLE section - it should have no reading line at all');
  });

  await t.test('2 feeds missing (VIX, Oil): both named under UNAVAILABLE, neither shows an invented number', () => {
    const prompt = buildMacroPrompt({ dxy: REAL, vix: null, gold: REAL, oil: null, tnx: REAL, goldOilRatio: null });
    assert.ok(prompt.includes('UNAVAILABLE'));
    assert.ok(prompt.includes('VIX') && (prompt.match(/VIX/g)?.length ?? 0) >= 1);
    assert.ok(!prompt.includes(String(INVENTED.vix) + ' ') && !prompt.includes('VIX (Fear Index):       ' + INVENTED.vix),
      `prompt contains the old hardcoded VIX stand-in (${INVENTED.vix}) despite VIX's fetch failing`);
    assert.ok(!prompt.includes('$' + INVENTED.oil),
      `prompt contains the old hardcoded Oil stand-in ($${INVENTED.oil}) despite Oil's fetch failing`);
  });

  await t.test('goldOilRatio null (either side missing) must not appear as a computed ratio line', () => {
    const prompt = buildMacroPrompt({ dxy: REAL, vix: REAL, gold: null, oil: REAL, tnx: REAL, goldOilRatio: null });
    assert.ok(!prompt.includes('Gold/Oil Ratio:'),
      'a Gold/Oil Ratio line appears even though gold (one side of the ratio) is unavailable - the old ' +
      "code always computed gold.price / oil.price even with an invented gold value plugged in");
  });

  await t.test('sanity: all 5 feeds present - every real value appears, no UNAVAILABLE section', () => {
    const prompt = buildMacroPrompt({ dxy: REAL, vix: REAL, gold: REAL, oil: REAL, tnx: REAL, goldOilRatio: 1.28 });
    assert.ok(!prompt.includes('UNAVAILABLE'), 'UNAVAILABLE appears even though every feed succeeded');
    assert.ok(prompt.includes('100.00') || prompt.includes('100'), 'the real DXY value does not appear in the prompt');
    assert.ok(prompt.includes('Gold/Oil Ratio:'), 'the ratio line is missing even though both sides are present');
  });
});
