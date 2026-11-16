/* #2400: the macro-context panel on /research says "Preparing the AI read…" while the server builds the read.
 *   M1  in the loading state the visible line uses the registered key GLOBAL_MACRO_CONTEXT_PREPARING (English default "Preparing the AI read…"), it is NOT inside the aria-hidden / sr-only text, and it occupies the SAME 20 px row as the pill it replaced (no layout shift), with the screen-reader fetching line kept
 *   M2  the product UI says "AI", never the vendor (OWNER-RULES 5): the English default and the three drafted translations contain no vendor/model name
 * Rows for ko/zh/ru (PROD = DEV, placeholders) are covered by labelMigrationsHeld.test.mts. WHAT IT CANNOT PROVE: that the line shows in a real slow load and its width in ru/ko/zh at 390 (browser cell). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const comp = read('components/GlobalMacroContext.tsx'), en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

test('M1. the loading state shows the registered "Preparing" line in the same 20 px row, keeping the screen-reader line', () => {
  const at = comp.indexOf("state === 'loading' && ("); assert.ok(at > 0, 'CONTROL: loading branch not found'); const blk = comp.slice(at, comp.indexOf("</div>\n      )}", at));
  assert.equal(en.GLOBAL_MACRO_CONTEXT_PREPARING, 'Preparing the AI read…'); assert.ok(read('lib/labelKeys.ts').includes("'GLOBAL_MACRO_CONTEXT_PREPARING'"), 'the key is not registered');
  assert.ok(/<div style=\{\{ height: 20, marginBottom: 10,[^}]*\}\}>\{t\('GLOBAL_MACRO_CONTEXT_PREPARING'\)\}<\/div>/.test(blk), 'the line is not a visible 20 px row with the key');
  assert.ok(blk.includes("<span className=\"sr-only\">{t('GLOBAL_MACRO_CONTEXT_FETCHING_SR')}</span>"), 'the screen-reader fetching line was lost');
  assert.equal(/aria-hidden/.test(blk.slice(blk.indexOf('GLOBAL_MACRO_CONTEXT_PREPARING') - 200, blk.indexOf('GLOBAL_MACRO_CONTEXT_PREPARING'))), false, 'the visible line is hidden from assistive technology');
});
test('M2. no vendor or model name in the English default or the drafted translations', () => {
  const sql = read('supabase/migrations/20261117a_labels_research_ai_preparing.sql'); const all = en.GLOBAL_MACRO_CONTEXT_PREPARING + sql.replace(/^--.*$/gm, '');
  assert.equal(/grok|xai|x\.ai|openai|gpt|claude|anthropic|gemini/i.test(all), false, 'the vendor is named in user-facing text');
});
