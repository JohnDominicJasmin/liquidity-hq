import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlainWords } from '../lib/grok.ts';
import type { CombinedResult } from '../lib/grok.ts';

/* Coverage for #2111 - the AI read must not print internal names like TRENDING_SHORT.
 *
 * REAL UNIT TESTS, not source assertions: `applyPlainWords` is exported, so every cell below calls
 * the shipped function. That matters here more than usual, because the thing under test IS a
 * regex's boundary behaviour - the one property a source assertion could not check and a
 * re-implementation would simply agree with me about.
 *
 * WHAT THE BACKSTOP IS FOR. The scoring rules in `lib/grok.ts` are written in this vocabulary on
 * purpose - "TRENDING_SHORT -> one bearish signal (+10)" - and the context line hands the model
 * `sig.verdict` raw so those rules can be applied. So the tokens must stay in the INPUT, and the
 * only reliable place to stop them reaching the OUTPUT is after the fact. The prompt instruction
 * added alongside it is a request; this is the part that holds.
 */

/** A CombinedResult carrying `text` in every prose field the sweep is supposed to cover. */
function resultWith(text: string): CombinedResult {
  return {
    chartAnalysis: text,
    reasoning: text,
    patterns: [text],
    catalysts: [text],
    waitFor: text,
    raidTarget: text,
    raidTrigger: text,
    levels: [{ label: text }],
    checks: [],
  } as unknown as CombinedResult;
}

function sweep(text: string) {
  const r = resultWith(text);
  const replaced = applyPlainWords(r);
  return { r, replaced };
}

test('P1. the tokens from the owner screenshot are rewritten in plain words', () => {
  const { r, replaced } = sweep('clear bearish technical structure with TRENDING_SHORT ribbon');
  assert.match(r.chartAnalysis, /trending down/, 'TRENDING_SHORT should read as plain words');
  assert.doesNotMatch(r.chartAnalysis, /TRENDING_SHORT/, 'the internal name must not survive');
  assert.deepEqual(replaced, ['TRENDING_SHORT'], 'the replacement should be reported for the audit trail');
});

test('P2. EVERY prose field is swept, not just reasoning', () => {
  /* The screenshot showed the leak in the long-form read, but the same text is generated for all of
     these - a sweep that covers one field moves the leak rather than closing it. */
  const { r } = sweep('a BOS breakdown');
  const fields: Array<[string, string]> = [
    ['chartAnalysis', r.chartAnalysis],
    ['reasoning', r.reasoning],
    ['patterns[0]', r.patterns[0]],
    ['catalysts[0]', r.catalysts[0]],
    ['waitFor', r.waitFor ?? ''],
    ['raidTarget', r.raidTarget ?? ''],
    ['raidTrigger', r.raidTrigger ?? ''],
    ['levels[0].label', r.levels[0].label],
  ];
  for (const [name, value] of fields) {
    assert.match(value, /break of structure/, `${name} was not swept`);
    assert.doesNotMatch(value, /\bBOS\b/, `${name} still carries the internal name`);
  }
});

test('P3. whole tokens only - the ban-in-bank trap stays closed', () => {
  /* EMBOSSED contains BOS. A substring matcher would mangle ordinary prose, which is the mistake
     the news matcher already had to fix once. */
  const { r, replaced } = sweep('the EMBOSSED chart border and an UNEMBOSSED one');
  assert.equal(r.chartAnalysis, 'the EMBOSSED chart border and an UNEMBOSSED one', 'prose was altered');
  assert.deepEqual(replaced, [], 'nothing should have been replaced');
});

test('P4. case-sensitive: the uppercase token is a leak, the lowercase word is English', () => {
  const lower = sweep('markets freeze in thin liquidity');
  assert.equal(lower.r.chartAnalysis, 'markets freeze in thin liquidity', 'ordinary English was rewritten');
  assert.deepEqual(lower.replaced, []);

  const upper = sweep('the ribbon is in FREEZE');
  assert.match(upper.r.chartAnalysis, /no clear trend/, 'the uppercase token should be rewritten');
  assert.deepEqual(upper.replaced, ['FREEZE']);
});

test('P5. NEUTRAL is deliberately left alone', () => {
  /* It is ordinary English AND a declared value of `bias`, which the UI renders through its own
     label. Mapping it here would rewrite correct prose. Pinned so a future "complete the map"
     change has to argue with this cell rather than silently break the bias wording. */
  const { r, replaced } = sweep('bias is NEUTRAL while the range holds');
  assert.equal(r.chartAnalysis, 'bias is NEUTRAL while the range holds');
  assert.deepEqual(replaced, []);
});

test('P6. tokens are caught in punctuation and mid-sentence', () => {
  const { r } = sweep('the ribbon (TRENDING_SHORT) agrees, and CHOCH followed.');
  assert.doesNotMatch(r.chartAnalysis, /TRENDING_SHORT|CHOCH/, 'punctuation-adjacent tokens must still be caught');
  assert.match(r.chartAnalysis, /trending down/);
  assert.match(r.chartAnalysis, /change of character/);
});

/* P7 and P8 WERE PINNED `test.todo` CELLS until #2115 landed the underscore-run fix; the markers
 * are stripped and the cells kept, which is what their original note asked for.
 *
 * Why they existed: `` does not bound these tokens, because JS counts `_` as a WORD character -
 * in `BOS_CONFIRMED` there is no boundary between `BOS` and `_`, so the token reached the reader
 * untouched. Not hypothetical: every token the prompt teaches contains an underscore, so
 * underscore-joining is the model native habit with them.
 *
 * They are the regression guard for that fix now. The run matcher consumes a whole
 * `[A-Z][A-Z0-9]*(_[A-Z0-9]+)+` run and records unknown runs in `checks`, so a name nobody has
 * mapped is noisy rather than silent - which is what these two assert from the outside. */
test('P7. an underscore-suffixed token is rewritten, not leaked', () => {
  const { r } = sweep('ribbon BOS_CONFIRMED on the 4h');
  assert.doesNotMatch(r.chartAnalysis, /BOS_CONFIRMED/,
    'BOS_CONFIRMED reaches the reader: \\b does not bound a token followed by an underscore');
});

test('P8. an underscore-extended token is rewritten, not leaked', () => {
  const { r } = sweep('ribbon TRENDING_SHORT_RIBBON agrees');
  assert.doesNotMatch(r.chartAnalysis, /TRENDING_SHORT_RIBBON/,
    'TRENDING_SHORT_RIBBON reaches the reader for the same reason as P7');
});

test('P9. CONTROL: the sweep reports what it changed, and reports nothing when it changes nothing', () => {
  /* The audit trail is the only record that the backstop fired, since `checks` is not shown in the
     UI (lib/grok.ts documents that). A sweep that silently rewrote text would be worse than one
     that does not fire: there would be no way to tell the prompt is being ignored. */
  const hit = sweep('TRENDING_LONG and LONG_SQ and SHORT_SETUP');
  assert.deepEqual(hit.replaced.sort(), ['LONG_SQ', 'SHORT_SETUP', 'TRENDING_LONG']);

  const clean = sweep('price reclaimed the range high on rising volume');
  assert.deepEqual(clean.replaced, [], 'a clean answer must report no replacements');
  assert.equal(clean.r.chartAnalysis, 'price reclaimed the range high on rising volume');
});
