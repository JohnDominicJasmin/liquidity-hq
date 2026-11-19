/* WORDY-TEXT SWEEP (#2653, #1185, OWNER-RULES 25 "this is not an essay or diary"): /liq, the Playbook card and /correlation say less.
 * Budgets (rule 25): a hint or card line 15 words, a tooltip 20, never a forecast. Expected values come from the PR's written rule, not from the code.
 *   W1  the ten shortened defaults sit inside their budget, and the numbers the PR states hold (disclaimer 9 words, footer 12, intro 15)
 *   W2  none of the ten reads as a forecast or advice (expect, will, should, good for, buy/sell it, chop)
 *   W3  GexTable no longer renders the hard-coded English paragraph under the options-pressure rows (it forecast: "expect it to chop", "good for buying dips")
 *   W4  /correlation: the scale-hint line above the grid is gone, one legend line stays, and the tooltip still carries the +1 / -1 scale
 *   W5  Playbook card: two-line clamp, a "More details" / "Collapse" link only when the text is longer, state reset on "new play", accessible name and expanded state
 *   W6  held migration 20261123d: ten keys x five locales, en equals the default, PROD and DEV blocks identical, placeholders kept, right script per locale, newest row, no AI vendor named
 * WHAT THIS CANNOT PROVE: how the card looks at 390 / 1280 or that the clamp measures right after a web font swaps (needs a browser), or that ko/zh/ru/ar read well (AI-drafted). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const rd = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const DEF = JSON.parse(rd('lib/labelDefaults.en.json')) as Record<string, string>;
const KEYS_SRC = rd('lib/labelKeys.ts');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const TEN = ['LIQ_DISCLAIMER', 'GEX_TABLE_SUBTITLE', 'GEX_TABLE_LEAN_ABOVE_FLIP', 'GEX_TABLE_LEAN_BELOW_FLIP', 'GEX_TABLE_REGIME_DESC_RANGING', 'GEX_TABLE_REGIME_DESC_TRENDING', 'LIQ_LEGEND_SHORT_TEXT', 'LIQ_LEGEND_LONG_TEXT', 'LIQ_LEGEND_MAGNET_TEXT', 'SOTD_FOOTER'];

test('W1. the ten shortened defaults are inside the rule-25 budget, and the PR\'s own numbers are true', () => {
  assert.ok(TEN.every((k) => k in DEF), 'a key was renamed or removed');
  assert.equal(words(DEF.LIQ_DISCLAIMER), 9, 'PR: the /liq disclaimer is 9 words');
  assert.equal(words(DEF.SOTD_FOOTER), 12, 'PR: the Playbook footnote is 12 words');
  assert.equal(words(DEF.GEX_TABLE_SUBTITLE), 15, 'PR: the options-pressure intro is 15 words');
  for (const k of TEN) assert.ok(words(DEF[k]) <= 15, `${k} is ${words(DEF[k])} words, over the 15-word line budget: "${DEF[k]}"`);
  /* a legend row is the bold lead plus the text; both together stay one line */
  const legends: Array<[string, string]> = [['LIQ_LEGEND_SHORT_BOLD', 'LIQ_LEGEND_SHORT_TEXT'], ['LIQ_LEGEND_LONG_BOLD', 'LIQ_LEGEND_LONG_TEXT'], ['LIQ_LEGEND_MAGNET_BOLD', 'LIQ_LEGEND_MAGNET_TEXT']];
  for (const [b, t] of legends) assert.ok(words(DEF[b]) + words(DEF[t]) <= 15, `${b} + ${t} = ${words(DEF[b]) + words(DEF[t])} words`);
  /* the lean line the user reads: label + reason + regime + description */
  const lean = ['↑ BULLISH LEAN', DEF.GEX_TABLE_LEAN_ABOVE_FLIP.replace('${flip}', '$65,000'), 'RANGING', DEF.GEX_TABLE_REGIME_DESC_RANGING].join(' - ');
  assert.ok(words(lean) <= 20, `the lean line is ${words(lean)} words: "${lean}"`);
});

test('W2. none of the ten reads as a forecast or as advice', () => {
  const BAD = /\bexpect|\bwill\b|\bshould\b|\bgood for\b|\bbuy(?:ing)? (?:dips?|it)\b|\bchop|\bwait\b|\bavoid\b|\brisky\b|\bbest time\b/i;
  const hits = TEN.filter((k) => BAD.test(DEF[k])).map((k) => `${k}: "${DEF[k]}"`);
  assert.deepEqual(hits, [], hits.join(' | '));
});

test('W3. the options-pressure paragraph is gone from GexTable (rule 25 and no-forecast)', () => {
  const src = rd('components/GexTable.tsx');
  assert.doesNotMatch(src, /gex-insight/, 'the .gex-insight paragraph is still rendered');
  assert.doesNotMatch(src, /expect it to chop|buying dips|selling rips|momentum trades work|trade with the trend/i, 'forecast / advice sentence still in GexTable');
  assert.match(src, /GEX_TABLE_LEAN_ABOVE_FLIP/, 'the lean line must still be rendered: it carries the same facts');
  assert.match(src, /GEX_TABLE_REGIME_DESC_RANGING/, 'the regime description must still be rendered');
});

test('W4. /correlation: one legend line, the scale line above the grid is gone, the tooltip still has the scale', () => {
  const src = rd('components/CorrelationTerminal.tsx');
  assert.doesNotMatch(src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), /CORRELATION_MATRIX_SCALE_HINT/, 'the scale hint is still rendered');
  assert.equal((src.match(/className="corr-legend"/g) || []).length, 1, 'exactly one legend element expected');
  for (const k of ['CORRELATION_LEGEND_GREEN_LABEL', 'CORRELATION_LEGEND_RED_LABEL', 'CORRELATION_LEGEND_BRIGHTNESS_HINT']) assert.match(src, new RegExp(k), `${k} missing from the legend`);
  assert.match(DEF.CORRELATION_MATRIX_TIP, /\+1/, 'the tooltip must still give +1');
  assert.match(DEF.CORRELATION_MATRIX_TIP, /[−-]1/, 'the tooltip must still give -1');
  assert.match(src, /CORRELATION_MATRIX_TIP/, 'the tooltip is no longer wired');
});

test('W5. Playbook card: two-line clamp, link only when longer, state resets, accessible', () => {
  const src = rd('components/SOTD.tsx'); const css = rd('app/globals.css');
  assert.match(css, /\.sotd-text-clamped\s*\{[^}]*-webkit-line-clamp:\s*2\b[^}]*overflow:\s*hidden/, 'the clamp is not two lines');
  assert.match(src, /className=\{`sotd-text\$\{open \? '' : ' sotd-text-clamped'\}`\}/, 'the text must be clamped exactly when it is not open');
  assert.match(src, /\{\(canExpand \|\| open\) && \(/, 'the link must show only when the text is longer (or while open, so it can collapse)');
  assert.match(src, /scrollHeight\s*>\s*el\.clientHeight/, 'the longer-than-two-lines test must compare scrollHeight with clientHeight');
  assert.match(src, /addEventListener\('resize', measure\)[\s\S]*removeEventListener\('resize', measure\)/, 'measured on resize and the listener is removed');
  assert.match(src, /const newSecret = \(\) => \{[\s\S]*?setOpen\(false\);[\s\S]*?\};/, '"new play" must close the open text');
  assert.match(src, /aria-expanded=\{open\}/, 'aria-expanded missing');
  const ctrl = /aria-controls="([^"]+)"/.exec(src); const id = /id="([^"]+)"/.exec(src);
  assert.ok(ctrl && id && ctrl[1] === id[1], 'aria-controls must name the id of the text element');
  assert.match(src, /open \? t\('CHAT_COLLAPSE'\) : t\('ARENA_MORE_DETAILS'\)/, 'link text: Collapse when open, More details when closed, both through labels');
  for (const k of ['CHAT_COLLAPSE', 'ARENA_MORE_DETAILS']) { assert.ok(KEYS_SRC.includes(`'${k}'`), `${k} not registered`); assert.ok(typeof DEF[k] === 'string' && DEF[k].length > 0, `${k} has no en default`); }
  assert.match(css, /\.sotd-more\s*\{[^}]*min-height:\s*(?:2[4-9]|[3-9]\d)px/, 'the link needs a target at least 24px tall (WCAG 2.2 AA 2.5.8)');
});

const MIG = '20261123d_labels_wordy_text.sql';
const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'(en|ko|zh|ru|ar)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
const un = (s: string) => s.replace(/''/g, "'");
const ph = (s: string) => [...s.matchAll(/\$?\{(\w+)\}/g)].map((m) => m[0]).sort().join(',');
function blocks() {
  const sql = rd('supabase/migrations/' + MIG);
  const i = sql.search(/insert into lhq_dev_labels/i); assert.ok(i > 0, 'DEV block missing');
  assert.match(sql.slice(0, i), /insert into lhq_labels\b/i, 'PROD block must insert into lhq_labels');
  const rows = (s: string) => [...s.matchAll(rowRe)].map((m) => [m[1], m[2], un(m[3])] as [string, string, string]);
  return { prod: rows(sql.slice(0, i)), dev: rows(sql.slice(i)), sql };
}
const SCRIPT: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };

test('W6a. migration: ten keys x en/ko/zh/ru/ar in each block, PROD and DEV identical, en equals the default', () => {
  const { prod, dev } = blocks();
  assert.equal(prod.length, 50, `PROD rows: ${prod.length}`); assert.equal(dev.length, 50, `DEV rows: ${dev.length}`);
  assert.deepEqual(prod, dev, 'the PROD and DEV blocks differ');
  for (const k of TEN) {
    for (const l of ['en', 'ko', 'zh', 'ru', 'ar']) assert.equal(prod.filter((r) => r[0] === k && r[1] === l).length, 1, `${k}/${l} must appear exactly once`);
    assert.equal(prod.find((r) => r[0] === k && r[1] === 'en')![2], DEF[k], `${k}: the stored en row differs from the shipped default`);
  }
  assert.deepEqual([...new Set(prod.map((r) => r[0]))].sort(), [...TEN].sort(), 'the migration touches keys outside the ten');
});

test('W6b. migration: placeholders match English in every locale, and each locale is in its own script', () => {
  const { prod } = blocks(); const bad: string[] = [];
  for (const [k, l, v] of prod) {
    if (ph(v) !== ph(DEF[k])) bad.push(`${k}/${l}: placeholders [${ph(v)}] vs en [${ph(DEF[k])}]`);
    if (l !== 'en' && !SCRIPT[l].test(v)) bad.push(`${k}/${l}: not written in the ${l} script: ${v}`);
    if (v.trim() !== v || v.length === 0) bad.push(`${k}/${l}: empty or padded`);
  }
  assert.deepEqual(bad, [], bad.join(' | '));
  assert.ok(ph(DEF.GEX_TABLE_LEAN_ABOVE_FLIP).includes('${flip}'), 'control: the check sees the ${flip} placeholder');
});

test('W6c. migration is the newest stored row of its keys, and no AI vendor is named in the copy', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const later: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n > MIG).sort()) {
    const sql = readFileSync(new URL(f, dir), 'utf8'); const dev = sql.search(/insert into lhq_dev_labels/i); const prod = dev > 0 ? sql.slice(0, dev) : sql;
    for (const m of prod.matchAll(rowRe)) if (TEN.includes(m[1])) later.push(`${m[1]}/${m[2]} in ${f}`);
  }
  assert.deepEqual(later, [], `a later migration overwrites these rows: ${later.join(', ')}`);
  const { prod } = blocks();
  const vendor = /\b(?:claude|anthropic|openai|chatgpt|gpt-?\d|gemini|grok|xai|deepseek)\b/i;
  const hits = [...TEN.map((k) => [k, DEF[k]]), ...prod.map((r) => [r[0] + '/' + r[1], r[2]])].filter(([, v]) => vendor.test(v)).map(([k]) => k);
  assert.deepEqual(hits, [], `an AI vendor is named: ${hits.join(', ')}`);
});
