/* QA BEHAVIOURAL PINS for PR #2588 item 1 (#1631): the Shadow Strategy hindsight note shows ONLY when the AI actually picked trade types.
 * Expectations are hand-derived from the PR body ("shadowPickMade is true for ... false for ..."), not copied from a run.
 *   S1  shadowPickMade table            S2  the page's own render condition, taken from components/TradeJournal.tsx and run on whole reports
 *   S3  one constant for prompt and page (source pins)   S4  the constant's literal is the sentence the prompt promises */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { SHADOW_NO_PICK_TEXT, shadowPickMade } from '../lib/shadowStrategy.ts';

const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const FALLBACK = 'Not enough trades per type to compare.';
const PICK = 'Shadow Win Rate: 62% (actual: 48%) | Shadow Avg R: 0.9 (actual: 0.2) | Trades kept: 22 of 40 closed.';

test('S4. the constant is exactly the sentence the prompt promises the AI will write', () => {
  assert.equal(SHADOW_NO_PICK_TEXT, FALLBACK);
});

test('S1. shadowPickMade: a pick is true; empty and the fallback (any case, spacing, final full stop) are false', () => {
  const rows: [string, string, boolean][] = [
    ['a pick (the PR sentence)', PICK, true],
    ['a pick with a hindsight sentence after it', PICK + ' These types were picked after the fact.', true],
    ['fallback exactly', FALLBACK, false],
    ['fallback lower case, no full stop (PR example)', 'not enough trades per type to compare', false],
    ['fallback lower case with full stop', 'not enough trades per type to compare.', false],
    ['fallback UPPER CASE', FALLBACK.toUpperCase(), false],
    ['fallback with surrounding spaces (PR example)', '  ' + FALLBACK + '  ', false],
    ['fallback with trailing newline and tab', FALLBACK + '\n\t', false],
    ['fallback without the final full stop', 'Not enough trades per type to compare', false],
    ['fallback in quotes (the prompt quotes it)', '"' + FALLBACK + '"', false],
    ['empty string', '', false],
    ['spaces only', '   \n ', false],
    ['a pick that merely CONTAINS the fallback words (PR: "one containing the fallback" is false)', PICK + ' ' + FALLBACK, false],
    ['the fallback words inside a longer sentence', 'Not enough trades per type to compare the long and short books separately.', false],
    ['near-miss: double space inside the sentence is NOT the fallback', 'Not  enough trades per type to compare.', true],
    ['unrelated text without stats is not the fallback, so it is a pick', 'Trades kept: 3 of 3 closed.', true],
  ];
  for (const [label, input, want] of rows) assert.equal(shadowPickMade(input), want, `${label}: shadowPickMade(${JSON.stringify(input)})`);
});

/* ---- S2: the condition the page really evaluates, lifted out of the component source and run against the real shadowPickMade ---- */
const tj = src('components/TradeJournal.tsx');
function lift() {
  const sections = /const SHADOW_SECTIONS[\s\S]*?\n\];\n/.exec(tj)?.[0];
  const parse = /function parseShadowSection[\s\S]*?\n}\n/.exec(tj)?.[0];
  assert.ok(sections && parse, 'SHADOW_SECTIONS / parseShadowSection not found in TradeJournal.tsx');
  const cond = /\{\s*(key === 'SHADOW_STRATEGY'[^\n]*?)\s*&&\s*\(\s*\n\s*<div[^>]*>\s*\n\s*\{t\('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE'\)\}/.exec(tj)?.[1];
  assert.ok(cond, 'the render guard in front of TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE was not found: ' + tj.slice(tj.indexOf('HINDSIGHT') - 300, tj.indexOf('HINDSIGHT') + 40));
  const js = ts.transpileModule(`${sections}\n${parse}\nexport const decide = (text: string, key: string) => { const content = parseShadowSection(text, key); return !!content && (${cond}); };\nexport { parseShadowSection, SHADOW_SECTIONS };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', 'shadowPickMade', js)(mod, mod.exports, shadowPickMade);
  return { cond, ...(mod.exports as { decide: (t: string, k: string) => boolean; parseShadowSection: (t: string, k: string) => string; SHADOW_SECTIONS: { key: string }[] }) };
}
const L = lift();
const report = (strategy: string) => [
  'IMPLICIT_RULES:\nBreakouts on BTC in the NY session.',
  'BEHAVIORAL_PATTERNS:\nHolds losers longer.',
  'SHADOW_STRATEGY:\n' + strategy,
  'RULE_VIOLATIONS:\nBTC 2026-11-02 moved the stop.',
  'RECOMMENDATIONS:\nKeep stops fixed.',
  'KEY_INSIGHT:\nThe edge is breakouts.',
].join('\n\n');

test('S2a. the page decision, on whole AI reports: note shown with a pick, hidden under the fallback / an empty section / a section the AI left out', () => {
  assert.equal(L.decide(report(PICK), 'SHADOW_STRATEGY'), true, 'pick: note must show');
  assert.equal(L.decide(report(FALLBACK), 'SHADOW_STRATEGY'), false, 'fallback: note must be hidden (this is the defect the PR fixes)');
  assert.equal(L.decide(report(FALLBACK.toLowerCase().slice(0, -1)), 'SHADOW_STRATEGY'), false, 'fallback, lower case, no full stop');
  assert.equal(L.decide(report('  ' + FALLBACK + '  '), 'SHADOW_STRATEGY'), false, 'fallback with spaces');
  assert.equal(L.decide(report(''), 'SHADOW_STRATEGY'), false, 'empty section: the card is not drawn at all');
  assert.equal(L.decide('IMPLICIT_RULES:\nx\nRULE_VIOLATIONS:\ny', 'SHADOW_STRATEGY'), false, 'section missing from the answer');
});
test('S2b. the note belongs to SHADOW_STRATEGY only: no other section shows it, whatever it holds', () => {
  for (const { key } of L.SHADOW_SECTIONS) if (key !== 'SHADOW_STRATEGY') assert.equal(L.decide(report(PICK), key), false, key);
});
test('S2c. the fallback never leaks into the neighbouring section: the section is cut at the next header', () => {
  assert.equal(L.parseShadowSection(report(FALLBACK), 'SHADOW_STRATEGY'), FALLBACK);
  assert.equal(L.parseShadowSection(report(PICK), 'SHADOW_STRATEGY'), PICK);
  /* the fallback written in the SECOND section must not hide the first pick's note */
  const t = 'SHADOW_STRATEGY:\n' + PICK + '\nRULE_VIOLATIONS:\n' + FALLBACK;
  assert.equal(L.decide(t, 'SHADOW_STRATEGY'), true);
});
test('S2d. the note is rendered in exactly one place and that place is behind the guard (source)', () => {
  assert.equal(tj.split("t('TRADE_JOURNAL_SHADOW_HINDSIGHT_NOTE')").length - 1, 1, 'the note renders in more than one place');
  assert.match(tj, /import \{ shadowPickMade \} from '@\/lib\/shadowStrategy';/);
  assert.equal(L.cond.replace(/\s+/g, ' '), "key === 'SHADOW_STRATEGY' && shadowPickMade(content)");
});

test('S3. prompt and page share ONE constant: neither the route nor the page holds the sentence as a literal', () => {
  const route = src('app/api/shadow-account/route.ts');
  const lib = src('lib/shadowStrategy.ts');
  assert.match(route, /import \{ SHADOW_NO_PICK_TEXT \} from '@\/lib\/shadowStrategy';/);
  assert.ok(route.includes('write "${SHADOW_NO_PICK_TEXT}" and nothing else'), 'the prompt does not interpolate the constant');
  assert.ok(!route.includes('Not enough trades per type'), 'the route still holds the sentence as a literal: it can drift from the page');
  /* the page's only mention of the sentence is the guard's comment; it must not be compared as a string */
  const code = tj.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('Not enough trades per type'), 'the page compares against its own copy of the sentence');
  assert.equal((lib.match(/Not enough trades per type to compare\./g) ?? []).length, 1, 'the literal must live in lib/shadowStrategy.ts only, once');
  assert.match(lib, /export const SHADOW_NO_PICK_TEXT = '/);
  assert.match(lib, /SHADOW_NO_PICK_TEXT\.slice\(0, -1\)\.toLowerCase\(\)/, 'the page tests against the same constant');
});
