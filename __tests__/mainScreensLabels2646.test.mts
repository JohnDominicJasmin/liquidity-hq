/* ENGLISH ON MAIN SCREENS (#2646, #1185 "ru/ko/zh users see English on main screens"): the Perps vs Spot card, the Setup checklist, the install prompt and the two /upgrade footer links read labels. English must read exactly as before.
 *   L1  PARITY: each English PERP_SPOT_EXPLAIN_* / PERP_SPOT_ABSORB_* default equals what lib/perpSpot.ts itself says for the same reading (the Arena AI prompt reads that text; the card rebuilds it from labels with the same numbers)
 *   L2  PerpSpotCard: every English literal is gone, the lean and the 20-point absorption cut match the library, and the AI-facing text is not rendered any more
 *   L3  SetupChecklist: the four rows, the pill, title, count and button names are the ORIGINAL English words in the defaults, and no literal is left in the component
 *   L4  PWAInstallPrompt and /upgrade links: same, original words
 *   L5  all 28 keys are registered once, have a default once (a duplicate JSON key silently wins), and interpolate with the variables the code passes
 *   L6  held migration 20261122b: 28 keys x en/ko/zh/ru/ar in PROD and DEV, identical, en equals the default, {placeholders} kept in all five locales (the generic M3 pin skips ar), right script per locale, verdict pills no longer than the longest English one
 * WHAT THIS CANNOT PROVE: the verdict pill at 390 in ru/ar (needs a browser), or that ko/zh/ru/ar read well (AI-drafted). The ORIGINAL English strings below are copied from the code on dev before this PR (the PR says English is unchanged). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { computePerpSpot, computeAbsorption, MIN_BARS } from '../lib/perpSpot.ts';

const rd = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const RAW = rd('lib/labelDefaults.en.json');
const DEF = JSON.parse(RAW) as Record<string, string>;
const KEYS = rd('lib/labelKeys.ts');
const interp = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (w, n) => (n in v ? String(v[n]) : w));
const nocomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\}/g, '');

const PERP = ['PERP_SPOT_TITLE', 'PERP_SPOT_RATIO_LABEL', 'PERP_SPOT_VERDICT_PERP', 'PERP_SPOT_VERDICT_SPOT', 'PERP_SPOT_VERDICT_NORMAL', 'PERP_SPOT_VERDICT_UNKNOWN', 'PERP_SPOT_EXPLAIN_PERP', 'PERP_SPOT_EXPLAIN_SPOT', 'PERP_SPOT_EXPLAIN_NORMAL', 'PERP_SPOT_EXPLAIN_UNKNOWN', 'PERP_SPOT_ABSORPTION_TITLE', 'PERP_SPOT_ABSORB_SPOT', 'PERP_SPOT_ABSORB_PERP', 'PERP_SPOT_ABSORB_NORMAL'];
const SETUP = ['SETUP_CL_TELEGRAM', 'SETUP_CL_PRICE_ALERT', 'SETUP_CL_AI', 'SETUP_CL_ARENA', 'SETUP_CL_MINI', 'SETUP_CL_TITLE', 'SETUP_CL_COUNT', 'SETUP_CL_DISMISS', 'SETUP_CL_MINIMIZE'];
const PWA = ['PWA_INSTALL_TITLE', 'PWA_INSTALL_DESC', 'PWA_INSTALL_BUTTON', 'PWA_INSTALL_DISMISS'];
const UPG = ['UPGRADE_LINK_SECURITY_DATA'];
const ALL = [...PERP, ...SETUP, ...PWA, ...UPG];

const HOUR = 3600_000; const T0 = Date.UTC(2026, 7, 12, 0, 0, 0);
function bars(n: number, ratio: number, lastRatio: number, spotTaker = 0.5, perpTaker = 0.5) {
  const spot = [], perp = [];
  for (let i = 0; i < n; i++) {
    const t = T0 + i * HOUR; const s = 10_000_000; const r = i === n - 1 ? lastRatio : ratio;
    spot.push({ time: t, quoteVolume: s, takerBuyQuoteVolume: s * spotTaker });
    perp.push({ time: t, quoteVolume: s * r, takerBuyQuoteVolume: s * r * perpTaker });
  }
  return { spot, perp, nowMs: T0 + n * HOUR };
}

test('L1a. English PERP_SPOT_EXPLAIN_* equal the library sentences, with the same {times} number (perp, spot, normal, unavailable)', () => {
  const cases: Array<[string, ReturnType<typeof bars>, string]> = [
    ['perp', bars(48, 7.8, 7.8 * 2), 'PERP_SPOT_EXPLAIN_PERP'],
    ['spot', bars(48, 7.8, 7.8 * 0.5), 'PERP_SPOT_EXPLAIN_SPOT'],
    ['normal', bars(48, 7.8, 7.8), 'PERP_SPOT_EXPLAIN_NORMAL'],
  ];
  for (const [lean, b, key] of cases) {
    const r = computePerpSpot(b.spot, b.perp, HOUR, b.nowMs);
    assert.equal(r.lean, lean, `fixture did not produce a ${lean} reading`);
    const times = r.relative != null ? `${r.relative.toFixed(1)}x` : '';
    assert.equal(interp(DEF[key], { times }), r.explanation, `${key}: the card would say something other than the Arena AI is told`);
  }
  const u = computePerpSpot([], [], HOUR, T0);
  assert.equal(u.lean, 'unknown'); assert.equal(DEF.PERP_SPOT_EXPLAIN_UNKNOWN, u.explanation);
  const short = bars(MIN_BARS - 1, 7.8, 7.8); const u2 = computePerpSpot(short.spot, short.perp, HOUR, short.nowMs);
  assert.equal(u2.lean, 'unknown'); assert.equal(DEF.PERP_SPOT_EXPLAIN_UNKNOWN, u2.explanation);
});

test('L1b. English PERP_SPOT_ABSORB_* equal the library observation for spot-led, perp-led and together, with the same rounded numbers', () => {
  const cases: Array<[string, number, number, string]> = [['spot-led', 0.68, 0.34, 'PERP_SPOT_ABSORB_SPOT'], ['perp-led', 0.30, 0.62, 'PERP_SPOT_ABSORB_PERP'], ['together', 0.50, 0.46, 'PERP_SPOT_ABSORB_NORMAL']];
  for (const [name, st, pt, key] of cases) {
    const b = bars(48, 7.8, 7.8, st, pt); const a = computeAbsorption(b.spot, b.perp, HOUR, b.nowMs);
    assert.ok(a.available, `${name}: fixture unavailable`);
    const sp = Math.round(a.spotTakerPct ?? 0), pp = Math.round(a.perpTakerPct ?? 0);
    assert.equal(interp(DEF[key], { sp, pp }), a.observation, `${name} (${key}): the card differs from the library observation`);
  }
  /* boundary: the library flips at exactly 20 points; the card must flip with it */
  for (const [st, pt, key] of [[0.70, 0.50, 'PERP_SPOT_ABSORB_SPOT'], [0.50, 0.70, 'PERP_SPOT_ABSORB_PERP'], [0.69, 0.50, 'PERP_SPOT_ABSORB_NORMAL']] as Array<[number, number, string]>) {
    const b = bars(48, 7.8, 7.8, st, pt); const a = computeAbsorption(b.spot, b.perp, HOUR, b.nowMs); const sp = Math.round(a.spotTakerPct ?? 0), pp = Math.round(a.perpTakerPct ?? 0);
    assert.equal(interp(DEF[key], { sp, pp }), a.observation, `boundary ${st}/${pt} should be ${key}`);
  }
});

test('L2. PerpSpotCard: no English literal left, same cut and lean mapping as the library, AI-facing strings not rendered', () => {
  const src = nocomment(rd('components/PerpSpotCard.tsx')); const lib = rd('lib/perpSpot.ts');
  for (const lit of ['Perps vs Spot', 'FUTURES ACTIVITY VS NORMAL', 'FUTURES LEADING', 'SPOT LEADING', 'CANNOT MEASURE', 'Spot Absorption', "'NORMAL'"]) assert.ok(!src.includes(lit), `English literal still in the card: ${lit}`);
  assert.doesNotMatch(src, /reading\.explanation|absorption\.observation/, 'the card still renders the library English, which would stay English in ru/ko/zh/ar');
  const delta = /const delta = sp - pp;[\s\S]*?delta >= (\d+)[\s\S]*?delta <= -(\d+)/.exec(lib); assert.ok(delta, 'control: the library cut was not found');
  assert.match(src, new RegExp(`sp - pp >= ${delta![1]} \\? t\\('PERP_SPOT_ABSORB_SPOT'`), 'the card spot-led cut differs from the library');
  assert.match(src, new RegExp(`sp - pp <= -${delta![2]} \\? t\\('PERP_SPOT_ABSORB_PERP'`), 'the card perp-led cut differs from the library');
  for (const [lean, k] of [['perp', 'PERP_SPOT_VERDICT_PERP'], ['spot', 'PERP_SPOT_VERDICT_SPOT'], ['normal', 'PERP_SPOT_VERDICT_NORMAL']]) assert.match(src, new RegExp(`reading\\.lean === '${lean}' \\? t\\('${k}'\\)`), `verdict for ${lean} is not ${k}`);
  assert.match(src, /t\('PERP_SPOT_VERDICT_UNKNOWN'\)/); assert.match(src, /t\('PERP_SPOT_TITLE', \{ coin: coin\.toUpperCase\(\) \}\)/);
  assert.match(src, /absorption\?\.available && \(/, 'the Spot Absorption block must stay hidden when the data is unavailable');
  assert.ok(lib.includes("'Spot data unavailable for this coin"), 'control: the library still carries the English the AI reads');
});

test('L3. SetupChecklist: the original English words are the defaults and no literal is left', () => {
  const ORIGINAL: Record<string, string> = { SETUP_CL_TELEGRAM: 'Connect Telegram alerts', SETUP_CL_PRICE_ALERT: 'Set a price alert', SETUP_CL_AI: 'Get an AI market analysis', SETUP_CL_ARENA: 'Explore the Arena', SETUP_CL_TITLE: 'Quick Setup', SETUP_CL_DISMISS: 'Dismiss setup checklist', SETUP_CL_MINIMIZE: 'Minimize' };
  for (const [k, v] of Object.entries(ORIGINAL)) assert.equal(DEF[k], v, `${k}: English changed from "${v}"`);
  for (const n of [0, 1, 2, 3, 4]) { assert.equal(interp(DEF.SETUP_CL_MINI, { done: n }), `Setup ${n}/4`); assert.equal(interp(DEF.SETUP_CL_COUNT, { done: n }), `${n}/4 done`); }
  const src = nocomment(rd('components/SetupChecklist.tsx'));
  for (const lit of ['Quick Setup', 'Connect Telegram alerts', 'Set a price alert', 'Get an AI market analysis', 'Explore the Arena', 'Dismiss setup checklist', '"Minimize"', '/4 done', 'Setup {doneCount}']) assert.ok(!src.includes(lit), `English literal still in the component: ${lit}`);
  assert.equal((src.match(/labelKey: 'SETUP_CL_/g) || []).length, 4, 'the checklist must have exactly 4 rows: the "/4" is inside the labels');
  assert.match(src, /t\('SETUP_CL_MINI', \{ done: doneCount \}\)/); assert.match(src, /t\('SETUP_CL_COUNT', \{ done: doneCount \}\)/);
  assert.equal((src.match(/aria-label=\{t\('SETUP_CL_DISMISS'\)\}/g) || []).length, 2, 'both dismiss buttons need the translated accessible name');
  assert.match(src, /aria-label=\{t\('SETUP_CL_MINIMIZE'\)\}/); assert.match(src, /\{t\(item\.labelKey\)\}/);
});

test('L4. install prompt and /upgrade links: the original English, read through labels', () => {
  const O: Record<string, string> = { PWA_INSTALL_TITLE: 'Add to Home Screen', PWA_INSTALL_DESC: 'Install LiquidityHQ for instant access', PWA_INSTALL_BUTTON: 'Install', PWA_INSTALL_DISMISS: 'Dismiss', UPGRADE_LINK_SECURITY_DATA: 'Security & data', PF_LINK_REFUND: 'Refund Policy' };
  for (const [k, v] of Object.entries(O)) assert.equal(DEF[k], v, `${k}: English changed from "${v}"`);
  const pwa = nocomment(rd('components/PWAInstallPrompt.tsx'));
  for (const lit of ['Add to Home Screen', 'Install LiquidityHQ', '>Install<', 'aria-label="Dismiss"']) assert.ok(!pwa.includes(lit), `English literal still in the prompt: ${lit}`);
  for (const k of PWA) assert.ok(pwa.includes(`t('${k}')`), `${k} is not read by the prompt`);
  assert.match(pwa, /import \{ useLabels \} from '@\/lib\/labels'/);
  const up = nocomment(rd('app/(main)/upgrade/page.tsx'));
  assert.match(up, /<Link href="\/refund"[^>]*>\s*\{t\('PF_LINK_REFUND'\)\}\s*<\/Link>/); assert.match(up, /<Link href="\/security"[^>]*>\s*\{t\('UPGRADE_LINK_SECURITY_DATA'\)\}\s*<\/Link>/);
  assert.ok(!/>\s*Refund Policy\s*</.test(up) && !/Security &amp; data/.test(up), 'an English footer literal is still on /upgrade');
});

test('L5. all 28 keys: registered once, one default each, not duplicated in the JSON text', () => {
  assert.equal(ALL.length, 28);
  const bad: string[] = [];
  for (const k of ALL) {
    const reg = (KEYS.match(new RegExp(`'${k}'`, 'g')) || []).length; if (reg !== 1) bad.push(`${k}: registered ${reg} times`);
    const dup = (RAW.match(new RegExp(`^\\s*"${k}":`, 'gm')) || []).length; if (dup !== 1) bad.push(`${k}: ${dup} defaults in the JSON`);
    if (typeof DEF[k] !== 'string' || DEF[k].trim() === '') bad.push(`${k}: empty default`);
  }
  assert.deepEqual(bad, [], bad.join(' | '));
  assert.equal(interp(DEF.PERP_SPOT_TITLE, { coin: 'BTC' }), 'Perps vs Spot · BTC');
});

const MIG = '20261122b_labels_english_on_main_screens.sql';
const rowRe = /\(\s*'((?:[^']|'')*)'\s*,\s*'(en|ko|zh|ru|ar)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const SCRIPT: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };
function mig() {
  const sql = rd('supabase/migrations/' + MIG); const i = sql.search(/insert into lhq_dev_labels/i); assert.ok(i > 0, 'DEV block missing');
  assert.match(sql.slice(0, i), /insert into lhq_labels\b/i);
  const rows = (s: string) => [...s.matchAll(rowRe)].map((m) => [m[1], m[2], m[3].replace(/''/g, "'")] as [string, string, string]);
  return { prod: rows(sql.slice(0, i)), dev: rows(sql.slice(i)) };
}

test('L6a. migration: 28 keys x 5 locales, PROD equals DEV, en equals the default, nothing outside the 28', () => {
  const { prod, dev } = mig();
  assert.equal(prod.length, 140, `PROD rows ${prod.length}`); assert.deepEqual(prod, dev, 'PROD and DEV blocks differ');
  for (const k of ALL) { for (const l of ['en', 'ko', 'zh', 'ru', 'ar']) assert.equal(prod.filter((r) => r[0] === k && r[1] === l).length, 1, `${k}/${l} must appear exactly once`); assert.equal(prod.find((r) => r[0] === k && r[1] === 'en')![2], DEF[k], `${k}: stored en differs from the default`); }
  assert.deepEqual([...new Set(prod.map((r) => r[0]))].sort(), [...ALL].sort());
});

test('L6b. migration: placeholders kept in all five locales, each locale in its own script, no AI vendor named', () => {
  const { prod } = mig(); const bad: string[] = []; const vendor = /\b(?:claude|anthropic|openai|chatgpt|gpt-?\d|gemini|grok|xai|deepseek)\b/i;
  for (const [k, l, v] of prod) {
    if (ph(v) !== ph(DEF[k])) bad.push(`${k}/${l}: placeholders [${ph(v)}] vs en [${ph(DEF[k])}]`);
    if (l !== 'en' && !SCRIPT[l].test(v)) bad.push(`${k}/${l}: not in the ${l} script: ${v}`);
    if (v.trim() !== v || !v) bad.push(`${k}/${l}: empty or padded`);
    if (vendor.test(v)) bad.push(`${k}/${l}: names an AI vendor`);
  }
  assert.deepEqual(bad, [], bad.join(' | '));
  assert.equal(ph(DEF.PERP_SPOT_ABSORB_SPOT), 'pp,sp'); assert.equal(ph(DEF.PERP_SPOT_EXPLAIN_PERP), 'times');
});

test('L6c. migration: no verdict pill is longer than the longest English one (the pill never shrinks: a longer one pushes the number to the next line)', () => {
  const { prod } = mig(); const verdicts = prod.filter((r) => /^PERP_SPOT_VERDICT_/.test(r[0]));
  const maxEn = Math.max(...verdicts.filter((r) => r[1] === 'en').map((r) => r[2].length)); assert.equal(maxEn, 15);
  const long = verdicts.filter((r) => r[2].length > maxEn).map((r) => `${r[0]}/${r[1]}: ${r[2]} (${r[2].length})`);
  assert.deepEqual(long, [], long.join(' | '));
});

test('L6d. migration is the newest stored row of its 28 keys', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const later: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n > MIG)) {
    const sql = readFileSync(new URL(f, dir), 'utf8'); const d = sql.search(/insert into lhq_dev_labels/i); const prod = d > 0 ? sql.slice(0, d) : sql;
    for (const m of prod.matchAll(rowRe)) if (ALL.includes(m[1])) later.push(`${m[1]}/${m[2]} in ${f}`);
  }
  assert.deepEqual(later, [], `a later migration overwrites these rows: ${later.join(', ')}`);
});
