/* #1152: the Free AND Pro feature lists used to be independent hardcoded lists (landing page i18n dict,
 * /upgrade label system) and had drifted - different Free scanner wording, a missing Free timeframe line on
 * landing, missing Free exclusions on /upgrade, hand-typed AI numbers with no link to lib/limits on both
 * plans, and the two Pro lists even differing in SHAPE (landing split "AI chat" and "live searches" into two
 * rows where /upgrade combined them). lib/planFeatures.ts (FREE_PLAN_FEATURES, PRO_PLAN_FEATURES) is now the
 * single source for the ROW SET, order, and included/excluded flags for both plans; each surface keeps only
 * its own localized TEXT (landing: URL-locale i18n dict; /upgrade: label system, which follows the signed-in
 * user's locale) - see planFeatures.ts's own header comment for why text is deliberately NOT shared. This is
 * the guard test both commits' own messages asked for: pin dict == labels in English, every row translated in
 * every locale, no orphan keys, numeric rows tracking the real caps - so the two copies can't structurally
 * drift again on the next edit, for either plan.
 *
 * FREE_PLAN_FEATURES, PRO_PLAN_FEATURES, the dictionaries, interpolate() and AI_LIMITS are all real, DOM-free
 * modules - imported and exercised directly, not source-grepped, same approach as
 * __tests__/entitlementsRetryBudget.test.mts. Only the two consuming components (app/upgrade/page.tsx,
 * components/LandingTerminal.tsx) are structure-checked at the bottom, since those are React components.
 *
 * Pro's combined AI_CHAT_SEARCH shape (one row: "{chat} AI chat messages + {search} live searches / day") is
 * the owner's call, relayed via PM/DevOps 2026-09-28 - the landing page used to split it into two rows;
 * PRO_PLAN_FEATURES' single combined row is now canonical for both surfaces. Not re-litigated here, just
 * pinned as the current shape (P1pro).
 *
 * `ar` is NOT dropped from this file despite being dead in the shipped app - dictionaries.ts's own SUPPORTED_
 * LOCALES is ['ko','zh'] only; `ar` is kept as a standalone export, deliberately, per that file's own
 * 2026-08-08 removal note (RTL was never implemented), and is not part of the `dictionaries` record the app
 * actually serves from. Tested anyway because dev's spec named it and both commits updated its real content -
 * if it's ever reinstated, it should already be correct, not a surprise. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FREE_PLAN_FEATURES, PRO_PLAN_FEATURES, type PlanFeature } from '../lib/planFeatures.ts';
import { en, ko, zh, ar, type LandingDict } from '../lib/i18n/dictionaries.ts';
import { interpolate } from '../lib/labels.ts';
import { AI_LIMITS } from '../lib/limits.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const labelDefaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

// Named, not `dictionaries` (that record is only { en, ko, zh } - `ar` isn't in it, see file header).
const LOCALES: Array<{ name: string; dict: LandingDict }> = [
  { name: 'en', dict: en }, { name: 'ko', dict: ko }, { name: 'zh', dict: zh }, { name: 'ar', dict: ar },
];

/* One block of guard tests per plan, run once for 'free' and once for 'pro' - the two plans share the exact
 * same drift risk (dict vs labels vs limits), so testing them identically is the point, not an abstraction
 * for its own sake. `dictFeatures` reads dict.pricing[plan].features generically. */
function testPlan(plan: 'free' | 'pro', rows: PlanFeature[], expectedShape: Array<[string, boolean]>, numericIds: string[], expectedVars: Record<string, Record<string, number>>) {
  const P = plan.toUpperCase();
  const dictFeatures = (dict: LandingDict) => dict.pricing[plan].features;

  test(`P1${plan}. ${P}_PLAN_FEATURES is exactly the ${expectedShape.length} documented rows, in order, with the right included flags - the shape everything else in this file assumes`, () => {
    const shape = rows.map((r) => [r.id, r.included]);
    assert.deepEqual(shape, expectedShape, `re-derive this test's every other ${plan} assertion before trusting them if this changed - the row set itself moved`);
  });

  test(`P2${plan}. excluded rows in ${P}_PLAN_FEATURES carry no interpolation vars - nothing for the numeric-row check to accidentally skip silently`, () => {
    for (const row of rows.filter((r) => !r.included)) {
      assert.equal(row.vars, undefined, `${row.id} is excluded but has vars - unexpected shape`);
    }
  });

  for (const { name, dict } of LOCALES) {
    test(`P3a${plan}. [${name}] every ${P}_PLAN_FEATURES id has a non-empty dict.pricing.${plan}.features entry`, () => {
      for (const row of rows) {
        const text = dictFeatures(dict)[row.id];
        assert.equal(typeof text, 'string', `${name}: dict.pricing.${plan}.features.${row.id} is missing or not a string`);
        assert.ok(text.trim().length > 0, `${name}: dict.pricing.${plan}.features.${row.id} is empty`);
      }
    });

    test(`P3c${plan}. [${name}] dict.pricing.${plan}.features has no orphan keys beyond ${P}_PLAN_FEATURES' ids - the two cannot drift apart in either direction`, () => {
      const dictKeys = Object.keys(dictFeatures(dict)).sort();
      const rowIds = rows.map((r) => r.id).sort();
      assert.deepEqual(dictKeys, rowIds, `${name}: dict.pricing.${plan}.features' key set does not match ${P}_PLAN_FEATURES' id set exactly`);
    });
  }

  test(`P3b${plan}. English dict text is IDENTICAL to labelDefaults.en for each ${plan} row's labelKey - the two English copies cannot silently reword apart`, () => {
    for (const row of rows) {
      const dictText = dictFeatures(en)[row.id];
      const labelText = labelDefaults[row.labelKey];
      assert.equal(typeof labelText, 'string', `${row.labelKey} has no English label default`);
      assert.equal(dictText, labelText, `${row.id}: landing dict English text != labelDefaults.en['${row.labelKey}']`);
    }
  });

  test(`P4${plan}. every ${plan} row's labelKey is actually registered in LABEL_KEYS - a typo'd labelKey in planFeatures.ts would otherwise render the raw key on /upgrade, silently`, () => {
    for (const row of rows) {
      assert.ok(LABEL_KEYS.includes(row.labelKey), `${row.id}'s labelKey '${row.labelKey}' is not in LABEL_KEYS`);
    }
  });

  test(`P5${plan}. the numeric rows (${numericIds.join(', ')}) interpolate to the REAL AI_LIMITS.${plan} numbers, in every locale - not just some number, the current cap`, () => {
    const numericRows = rows.filter((r) => r.vars);
    assert.deepEqual(numericRows.map((r) => r.id), numericIds, `re-derive this test - the ${plan} numeric-row set changed`);
    for (const { name, dict } of LOCALES) {
      for (const row of numericRows) {
        const template = dictFeatures(dict)[row.id];
        const out = interpolate(template, row.vars);
        assert.doesNotMatch(out, /\{\w+\}/, `${name}.${row.id}: a placeholder was left unfilled - interpolate() and the row's vars have drifted apart`);
        for (const [varName, value] of Object.entries(row.vars!)) {
          assert.ok(out.includes(String(value)), `${name}.${row.id}: interpolated text does not contain ${varName}=${value} (AI_LIMITS.${plan}.${varName})`);
        }
      }
    }
    // The vars themselves are read from AI_LIMITS[plan], not hand-typed - confirm that wiring directly too.
    // expectedVars is written out explicitly per row (not reflectively derived from the var names) because
    // the mapping isn't always name-for-name: PRO's 'toolPool' row's var is called `tools`, sourced from
    // AI_LIMITS.pro.toolPool - a generic "look up AI_LIMITS[varName]" reconstruction silently produced 0 for
    // it on the first pass here (toolPool !== tools) and had to be caught and fixed, not assumed correct.
    for (const row of numericRows) {
      assert.deepEqual(row.vars, expectedVars[row.id], `${row.id}: vars are not exactly AI_LIMITS.${plan}'s own numbers`);
    }
  });
}

testPlan('free', FREE_PLAN_FEATURES, [
  ['dashboard', true], ['briefing', true], ['news', true], ['scanner', true], ['charts', true],
  ['aiIncluded', true], ['aiAnalyses', true], ['aiChat', true],
  ['telegram', false], ['priceAlerts', false],
], ['aiAnalyses', 'aiChat'], {
  aiAnalyses: { quick: AI_LIMITS.free.quick, deep: AI_LIMITS.free.deep },
  aiChat: { chat: AI_LIMITS.free.chat },
});

testPlan('pro', PRO_PLAN_FEATURES, [
  ['everythingFree', true], ['fastTimeframes', true], ['confluence', true], ['onchainMacro', true],
  ['telegram', true], ['unlimitedAlerts', true],
  ['aiAnalyses', true], ['aiChatSearch', true], ['toolPool', true],
], ['aiAnalyses', 'aiChatSearch', 'toolPool'], {
  aiAnalyses: { quick: AI_LIMITS.pro.quick, deep: AI_LIMITS.pro.deep },
  aiChatSearch: { chat: AI_LIMITS.pro.chat, search: AI_LIMITS.pro.search },
  toolPool: { tools: AI_LIMITS.pro.toolPool ?? 0 },
});

test('P0. Pro has no excluded rows - it is the everything tier, unlike Free which has two', () => {
  assert.equal(PRO_PLAN_FEATURES.filter((r) => !r.included).length, 0);
});

test('P0b. \'telegram\' exists as an id in BOTH plans with opposite included flags (Free: excluded, Pro: included) - confirms the two plans\' dict namespaces are genuinely separate (dict.pricing.free.features vs dict.pricing.pro.features), not one shared object an id collision could corrupt', () => {
  const freeTelegram = FREE_PLAN_FEATURES.find((r) => r.id === 'telegram')!;
  const proTelegram = PRO_PLAN_FEATURES.find((r) => r.id === 'telegram')!;
  assert.equal(freeTelegram.included, false);
  assert.equal(proTelegram.included, true);
  assert.notEqual(en.pricing.free.features.telegram, en.pricing.pro.features.telegram, 'Free and Pro telegram rows should not accidentally share text - they describe opposite inclusion');
});

/* ══ The two consuming components: both must render FROM the shared lists, not a re-hardcoded local one -
   the entire point of #1152 is that a parallel hardcoded array can't quietly reappear in either file. ══ */

test('P6. app/upgrade/page.tsx renders FREE_PLAN_FEATURES and PRO_PLAN_FEATURES (imported), not local re-hardcoded lists', () => {
  const source = stripComments(read('app/upgrade/page.tsx'));
  assert.match(source, /import\s*\{[^}]*\bFREE_PLAN_FEATURES\b[^}]*\bPRO_PLAN_FEATURES\b[^}]*\}\s*from\s*['"]@\/lib\/planFeatures['"]/, 'FREE_PLAN_FEATURES and PRO_PLAN_FEATURES are not both imported from @/lib/planFeatures');
  assert.match(source, /FREE_PLAN_FEATURES\.map\(/, 'FREE_PLAN_FEATURES is not mapped over in the render');
  assert.match(source, /PRO_PLAN_FEATURES\.map\(/, 'PRO_PLAN_FEATURES is not mapped over in the render');
  assert.doesNotMatch(source, /const\s+FREE_FEATURES\s*[:=]/, 'a local FREE_FEATURES array is back - the single-source point of #1152 is defeated');
  assert.doesNotMatch(source, /const\s+PRO_FEATURES\s*[:=]/, 'a local PRO_FEATURES array is back - the single-source point of #1152 is defeated');
});

test('P7. components/LandingTerminal.tsx renders FREE_PLAN_FEATURES and PRO_PLAN_FEATURES (imported) for row set/order/flags, with dict text interpolated through the real interpolate()', () => {
  const source = stripComments(read('components/LandingTerminal.tsx'));
  assert.match(source, /import\s*\{[^}]*\bFREE_PLAN_FEATURES\b[^}]*\bPRO_PLAN_FEATURES\b[^}]*\}\s*from\s*['"]@\/lib\/planFeatures['"]/, 'FREE_PLAN_FEATURES and PRO_PLAN_FEATURES are not both imported from @/lib/planFeatures');
  assert.match(source, /import\s*\{[^}]*\binterpolate\b[^}]*\}\s*from\s*['"]@\/lib\/labels['"]/, 'interpolate is not imported from @/lib/labels');
  assert.match(source, /FREE_PLAN_FEATURES\.map\(/, 'FREE_PLAN_FEATURES is not mapped over in the render');
  assert.match(source, /PRO_PLAN_FEATURES\.map\(/, 'PRO_PLAN_FEATURES is not mapped over in the render');
  assert.doesNotMatch(source, /dict\.pricing\.free\.features\.map\(/, 'still mapping dict.pricing.free.features as an array - it is a Record now, keyed by row id');
  assert.doesNotMatch(source, /dict\.pricing\.pro\.features\.map\(/, 'still mapping dict.pricing.pro.features as an array - it is a Record now, keyed by row id');
});
