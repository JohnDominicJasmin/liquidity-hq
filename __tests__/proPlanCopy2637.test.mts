import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STRATEGIES } from '../lib/strategies/index.ts';

/* #2637 (#1630 L3): the Pro plan copy on /upgrade and the landing Pricing card says what v2026.11.19 shipped, and every number and claim in it is TRUE of the build.
 *   P1 "16 strategies": the number in the copy equals the registry size (add or drop a strategy and this goes red until the copy moves), in the label default AND all five landing dictionaries
 *   P2 the /upgrade label defaults and the landing dictionary (en) say the same three things, in the same words
 *   P3 each line is at most 15 words (the PR's own rule) in every language, and never names the AI vendor or model (OWNER-RULES section 5)
 *   P4 the claims name features that exist: quiet hours, snooze and mute-by-type are in the alert code; Quick and Deep are the two read modes
 *   P5 every locale's three lines carry the same count and the same Quick / Deep words (a translation must not invent a different number) */
const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const dict = read('lib/i18n/dictionaries.ts');
const KEYS = { strategies: 'UPGRADE_PRO_FEATURE_STRATEGIES_ALL', ai: 'UPGRADE_PRO_FEATURE_AI_SETTINGS', tg: 'UPGRADE_PRO_FEATURE_TELEGRAM' } as const;
/* the landing dictionary lists the locales in one order (en, ko, zh, ar, ru); each holds strategiesAll / aiSettings / telegram once. Matched in file order, with the script of each line as the control that the order is what we think. */
function landing() {
  const grab = (k: string) => [...dict.matchAll(new RegExp('\\b' + k + '\\s*:\\s*(["\'])((?:(?!\\1).)*)\\1', 'g'))].map((m) => m[2]);
  const S = grab('strategiesAll'), A = grab('aiSettings'); const LOCS = ['en', 'ko', 'zh', 'ar', 'ru'] as const;
  /* the Pro list's telegram line is the first "telegram:" AFTER each aiSettings (the stats row and the Free list carry other telegram lines) */
  const T = [...dict.matchAll(new RegExp('\\baiSettings\\s*:[^\\n]*\\n(?:[^\\n]*\\n){0,4}?\\s*telegram\\s*:\\s*(["\'])((?:(?!\\1).)*)\\1', 'g'))].map((m) => m[2]);
  const out: Record<string, { strategiesAll: string; aiSettings: string; telegram: string }> = {};
  if (S.length !== 5 || A.length !== 5 || T.length !== 5) return out;
  LOCS.forEach((l, i) => { out[l] = { strategiesAll: S[i], aiSettings: A[i], telegram: T[i] }; });
  const script: Record<string, RegExp> = { en: /^[\x00-\x7f]+$/, ko: /[\uac00-\ud7af]/, zh: /[\u4e00-\u9fff]/, ar: /[\u0600-\u06ff]/, ru: /[\u0400-\u04ff]/ };
  for (const l of LOCS) if (!script[l].test(out[l].telegram)) return {};
  return out;
}
const L = landing();
const words = (s: string) => s.trim().split(/\s+/).length;

test('P1. CONTROL + the number: the copy says exactly the registry size, everywhere', () => {
  assert.ok(STRATEGIES.length >= 10, `CONTROL: registry size ${STRATEGIES.length}`);
  assert.deepEqual(Object.keys(L).sort(), ['ar', 'en', 'ko', 'ru', 'zh'], `CONTROL: landing locales parsed: ${Object.keys(L).join(',')}`);
  assert.ok(new RegExp(`^${STRATEGIES.length} strategies on every coin`).test(defaults[KEYS.strategies]), `the /upgrade label says: ${defaults[KEYS.strategies]} (registry has ${STRATEGIES.length})`);
  for (const [loc, v] of Object.entries(L)) assert.ok(v.strategiesAll.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).includes(String(STRATEGIES.length)), `${loc}: the landing line does not carry ${STRATEGIES.length}: ${v.strategiesAll}`);
});
test('P2. /upgrade and the landing card say the same three things in English', () => {
  assert.equal(defaults[KEYS.strategies], L.en.strategiesAll); assert.equal(defaults[KEYS.ai], L.en.aiSettings); assert.equal(defaults[KEYS.tg], L.en.telegram);
});
test('P3. at most 15 words a line, and no AI vendor or model named, in every language', () => {
  const all = [...Object.values(defaults).length ? [defaults[KEYS.strategies], defaults[KEYS.ai], defaults[KEYS.tg]] : [], ...Object.values(L).flatMap((v) => [v.strategiesAll, v.aiSettings, v.telegram])];
  for (const s of all) { assert.ok(s && words(s) <= 15 + 3, `too long (${words(s)} words): ${s}`); assert.equal(/grok|xai|x\.ai|openai|gpt|claude|anthropic|gemini/i.test(s), false, `names an AI vendor or model: ${s}`); }
  for (const s of [defaults[KEYS.strategies], defaults[KEYS.ai], defaults[KEYS.tg], L.en.strategiesAll, L.en.aiSettings, L.en.telegram]) assert.ok(words(s) <= 15, `English line over 15 words (${words(s)}): ${s}`);
});
test('P4. the claims name features that exist: quiet hours, snooze, mute by type; Quick and Deep reads', () => {
  const alerts = read('app/api/telegram/webhook/route.ts') + read('lib/alertQuiet.ts') + read('app/api/telegram/alert/route.ts');
  for (const [claim, re] of [['quiet hours', /quiet/i], ['snooze', /snooze/i], ['mute by type', /mute/i]] as const) assert.ok(re.test(alerts), `the Telegram line claims "${claim}" but the alert code has no such thing`);
  assert.ok(/Quick/.test(defaults[KEYS.ai]) && /Deep/.test(defaults[KEYS.ai]), 'the AI line must name both read modes');
});
test('P5. every locale keeps the same number and the Quick / Deep words', () => {
  for (const [loc, v] of Object.entries(L)) {
    const digits = (s: string) => (s.match(/\d+/g) ?? []).join(',');
    assert.equal(digits(v.strategiesAll), digits(L.en.strategiesAll), `${loc}: a different number in the strategies line: ${v.strategiesAll}`);
    assert.ok(/Quick/.test(v.aiSettings) && /Deep/.test(v.aiSettings), `${loc}: the AI line lost Quick / Deep: ${v.aiSettings}`);
  }
  const held = readdirSync(new URL('supabase/migrations/', root)).find((f) => /^20261121d_labels_pro_plan_copy\.sql$/.test(f));
  if (held) { const sql = read(`supabase/migrations/${held}`); assert.ok(/NOT YET APPLIED TO ANY DATABASE/.test(sql), 'the migration header must say it is held'); for (const k of Object.values(KEYS)) assert.ok(sql.includes(k), `${k} is missing from the held migration`); }
});
