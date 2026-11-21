/* RE-PINNED 2026-11-20 for #2741. #2741 routes the briefing event row's countdown text through hToHMt (labels BRIEFING_DUR_MIN / _HM / _H, migration 20261128c); hToHM stays English for the AI-prompt line. The three T1 pins that read the event row were stale: (a) the cut expression now calls hToHMt(lh, t), (b) the "in 2h 30m" case now routes to BRIEFING_EVENT_IN with a nested BRIEFING_DUR_HM and reads in the language ("2시간 30분 후", "2 小时 30 分钟后", "через 2 ч 30 мин"), (c) the ko / zh / ru English-unit exemption for that row is gone because it no longer prints English units. Everything else is #2738's text unchanged.
 * QA: PR #2738 (#1185, PM go 2026-11-20), the hardcoded English that ko / zh / ru visitors still saw goes through labels: relative times, the offline / funding-loading / global-error screens, sign-in errors, the landing footer. Stacked on #2737.
 *
 * THE WRITTEN RULES (Dev's PR body; the literals are the PR's, not read off the code):
 *   (1) friendlyAuthError(message, t?): WITHOUT t the old English text comes back exactly, for every known message; WITH t it returns t(KEY) (the label text); an unknown message is returned unchanged and t is not called. login (5 calls), forgot-password (1), reset-password (1), settings (1) and auth/callback (3) now pass t.
 *   (2) migration 20261128b: 23 keys x en / ko / zh / ru = 92 rows per block (PROD lhq_labels, DEV lhq_dev_labels, the same rows), additive upsert only, shaped like 20261128a; every key is in LABEL_KEYS and labelDefaults.en.json, en == the default, every ko / zh / ru value has the English {placeholder} set, none empty, none names an AI vendor, none is one of the four legal strings.
 *   (3) every locale in lib/i18n/dictionaries.ts carries footer.ack with {disclaimer} {terms} {privacy} once each, plus riskTitle and links.terms / privacy / contact; LandingTerminal splits it into three working links. The disclaimer paragraph and the six disclosure bodies stay English on purpose (PM).
 *   (4) COPY in app/global-error.tsx has en / ko / zh / ru / ar with the same keys, read from the stored language lhq_lang_v1.
 *   (5) relative times go through the label keys: tsAgo (briefing), relTime (chat history), timeAgo (news ticker AND news provider), countdown (news), fmtAge (market structure), and the inline brief-cached / yen-updated / event-row / upcoming-alert expressions.
 * Cells:
 *   A1  friendlyAuthError on every known message, with and without t (real function), in the four languages; unknown messages untouched
 *   A2  the five pages' call sites (counts, 2nd argument is t, t is in scope); no other caller of friendlyAuthError in the tree
 *   M1  the migration: rows, blocks, placeholders, script, vendor, legal keys, additive, shape, defaults, LABEL_KEYS
 *   D1  the dictionaries: ack slots, links, riskTitle in en / ko / zh / ru / ar; the split LandingTerminal runs; its source pins
 *   E1  the global-error COPY (cut from the real file): five locales, same keys, script per language; the stored-language read
 *   E2  offline/page.tsx and funding/loading.tsx read their labels (client components under the labels provider)
 *   T1  the relative-time functions CUT FROM THE REAL SOURCES, run on literal ages in en / ko / zh (ru where the keys are in the repo); key routing for every language
 *   T2  every call of the time helpers passes t
 * A CONTROL per rule: a deliberately broken synthetic input the checker must flag (the checkers are the same functions the real cells call).
 * WHAT THIS CANNOT PROVE: that the rows are applied (held migration; PM applies the DEV block), that ko / zh / ru read well (AI-drafted, not native-reviewed), that global-error / offline / funding render right at 390 px, that the ru rows for the EXISTING keys ALERTS_AGO_* / NEWS_TIME_* exist in DEV and PROD (no migration in the repo seeds ru for them; T1 pins their routing for ru, not their text). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { friendlyAuthError } from '../lib/authErrors.ts';
import { interpolate } from '../lib/labels.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';
import { dictionaries, en as dEn, ko as dKo, zh as dZh, ru as dRu, ar as dAr } from '../lib/i18n/dictionaries.ts';
import { stripSqlComments } from '../qa/sqlLabelRows.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LANGS = ['en', 'ko', 'zh', 'ru'] as const;
type Lang = (typeof LANGS)[number];
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

/* the 23 keys, written out from the PR body's list (not read off the migration), and the four legal strings from OWNER-RULES section 5 (claudeEngine E7 holds the same four) */
const NEW_KEYS = [
  'AUTH_ERR_EMAIL_NOT_CONFIRMED', 'AUTH_ERR_PASSWORD_POLICY', 'AUTH_ERR_SAME_PASSWORD', 'AUTH_ERR_SUSPENDED',
  'BRIEFING_AGO_HM', 'BRIEFING_EVENT_IN', 'BRIEFING_EVENT_NOW', 'CHAT_HISTORY_MESSAGES', 'FUNDING_PAGE_LOADING',
  'MARKET_STRUCTURE_AGO_CURRENT', 'MARKET_STRUCTURE_AGO_D', 'MARKET_STRUCTURE_AGO_DH', 'MARKET_STRUCTURE_AGO_H',
  'NEWS_COUNTDOWN_DAYS', 'NEWS_COUNTDOWN_DAYS_ONLY', 'NEWS_COUNTDOWN_HOURS', 'NEWS_COUNTDOWN_NOW', 'NEWS_COUNTDOWN_PASSED', 'NEWS_UPCOMING_ALERT',
  'OFFLINE_PAGE_BODY', 'OFFLINE_PAGE_TITLE', 'SETTINGS_PUSH_UNAVAILABLE', 'SETTINGS_PUSH_UNSUPPORTED',
];
const LEGAL_KEYS = ['DISCLAIMER_SECTION_AI_ANALYSIS_BODY', 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY', 'PRIVACY_SECTION_THIRD_PARTY_BODY', 'TERMS_SECTION_THIRD_PARTY_DATA_BODY'];
const VENDOR = /\b(xai|grok|openai|anthropic|claude|gpt|gemini)/i;

/* ───────────────────────── helpers: cutting real code ───────────────────────── */
/* from the first `{` after `marker` to its matching `}`, skipping quoted strings, so a brace inside a literal does not move the match */
function cutBlock(src: string, marker: string): string {
  const s = src.indexOf(marker); assert.ok(s >= 0, `CONTROL: marker not found: ${marker}`);
  const o = src.indexOf('{', s); let d = 0; let q = '';
  for (let i = o; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}' && --d === 0) return src.slice(s, i + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}
/* every top-level argument list of `name(` calls in src (declaration lines excluded), split on depth-0 commas */
function callArgs(src: string, name: string): string[][] {
  const out: string[][] = []; const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g'); let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    let d = 1; let q = ''; const args: string[] = []; let cur = '';
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (q) { cur += c; if (c === '\\') { cur += src[++i]; } else if (c === q) q = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) { args.push(cur.trim()); break; } }
      if (c === ',' && d === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(args);
  }
  return out;
}
const NOW = Date.UTC(2027, 0, 15, 12, 0, 0);
const RealDate = Date;
function FakeDate(this: unknown, ...a: unknown[]) { return a.length ? new (RealDate as unknown as new (...x: unknown[]) => Date)(...a) : new RealDate(NOW); }
(FakeDate as unknown as { now: () => number }).now = () => NOW;
function load<T>(code: string, name: string, deps: Record<string, unknown> = {}): T {
  const js = stripTypeScriptTypes(code);
  return new Function('Date', ...Object.keys(deps), `${js}\nreturn ${name};`)(FakeDate, ...Object.values(deps)) as T;
}
function expr<A extends string[]>(text: string, args: A): (...v: unknown[]) => string {
  return new Function(...args, `return (${text});`) as (...v: unknown[]) => string;
}

/* ───────────────────────── helpers: label rows ───────────────────────── */
type Row = { key: string; locale: string; value: string };
const BLOCK_RE = /insert into (lhq_labels|lhq_dev_labels) \(key, locale, value\) values\n([\s\S]*?)\non conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g;
const ROW_RE = /^\('([A-Z0-9_]+)','([a-z]{2}(?:-[A-Z]{2})?)','((?:[^']|'')*)'\),?$/;
function blocksOf(raw: string): { table: string; rows: Row[]; lines: number }[] {
  const sql = stripSqlComments(raw); const out = []; let m: RegExpExecArray | null; BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(sql))) {
    const lines = m[2].split('\n').filter((l) => l.trim());
    const rows = lines.map((l) => ROW_RE.exec(l.trim())).filter((r): r is RegExpExecArray => !!r).map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
    out.push({ table: m[1], rows, lines: lines.length });
  }
  return out;
}
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const MIG = '20261128b_labels_hardcoded_screens_times.sql';
const migRaw = read(`supabase/migrations/${MIG}`);
const migBlocks = blocksOf(migRaw);
const prodRows = migBlocks.find((b) => b.table === 'lhq_labels')?.rows ?? [];
const batch3Rows = blocksOf(read('supabase/migrations/20261128c_labels_scanner_absorption_journal.sql')).find((b) => b.table === 'lhq_labels')?.rows ?? []; // RE-PINNED 2026-11-20 for #2741
const newRow = (rows: Row[], key: string, l: string) => rows.find((r) => r.key === key && r.locale === l)?.value;

/** Every violation of the migration rules in `raw`; [] when it is clean. Pure, so the controls can feed it broken text. */
function migViolations(raw: string, defs: Record<string, string>, labelKeys: readonly string[]): string[] {
  const v: string[] = []; const b = blocksOf(raw);
  const prod = b.find((x) => x.table === 'lhq_labels'); const dev = b.find((x) => x.table === 'lhq_dev_labels');
  if (b.length !== 2 || !prod || !dev) { return [`expected exactly one PROD and one DEV upsert block, found ${b.map((x) => x.table).join(',')}`]; }
  for (const blk of b) if (blk.lines !== blk.rows.length) v.push(`${blk.table}: ${blk.lines - blk.rows.length} row line(s) do not parse`);
  if (JSON.stringify(prod.rows) !== JSON.stringify(dev.rows)) v.push('PROD and DEV blocks differ');
  for (const blk of b) {
    if (blk.rows.length !== NEW_KEYS.length * LANGS.length) v.push(`${blk.table}: ${blk.rows.length} rows, expected ${NEW_KEYS.length * LANGS.length}`);
    const seen = new Set<string>();
    for (const r of blk.rows) { const id = `${r.key}/${r.locale}`; if (seen.has(id)) v.push(`${blk.table}: duplicate ${id}`); seen.add(id); }
  }
  const rows = prod.rows;
  const keys = [...new Set(rows.map((r) => r.key))].sort();
  if (JSON.stringify(keys) !== JSON.stringify([...NEW_KEYS].sort())) v.push(`key set differs from the PR's 23: extra ${keys.filter((k) => !NEW_KEYS.includes(k))} missing ${NEW_KEYS.filter((k) => !keys.includes(k))}`);
  for (const k of NEW_KEYS) {
    if (!labelKeys.includes(k)) v.push(`${k} not in LABEL_KEYS`);
    if (!(k in defs)) v.push(`${k} not in labelDefaults.en.json`);
    if (LEGAL_KEYS.includes(k)) v.push(`${k} is one of the four legal strings`);
    const enV = newRow(rows, k, 'en');
    if (enV !== defs[k]) v.push(`${k}/en differs from labelDefaults.en.json`);
    for (const l of LANGS) {
      const val = newRow(rows, k, l);
      if (val === undefined) { v.push(`${k}/${l} row missing`); continue; }
      if (!val.trim()) v.push(`${k}/${l} is empty`);
      if (VENDOR.test(val)) v.push(`${k}/${l} names an AI vendor`);
      for (const tok of val.match(/\{[^}]*\}/g) ?? []) if (!/^\{\w+\}$/.test(tok)) v.push(`${k}/${l} malformed placeholder ${tok}`);
      if (enV !== undefined && JSON.stringify(ph(val)) !== JSON.stringify(ph(enV))) v.push(`${k}/${l} placeholders ${JSON.stringify(ph(val))} vs en ${JSON.stringify(ph(enV))}`);
    }
  }
  const stripped = stripSqlComments(raw).replace(BLOCK_RE, '').trim();
  if (stripped) v.push(`SQL outside the two upsert blocks: ${stripped.slice(0, 60)}`);
  if (!/^-- NOT YET APPLIED TO ANY DATABASE\./.test(raw)) v.push('the held header is missing');
  if (/\b(delete|drop|alter|truncate)\b/i.test(stripSqlComments(raw).replace(/'(?:[^']|'')*'/g, "''"))) v.push('a destructive statement');
  return v;
}

/* ═════════════════════════ A. friendlyAuthError ═════════════════════════ */
const KNOWN: Array<[string, string, string]> = [
  ['Email not confirmed', 'AUTH_ERR_EMAIL_NOT_CONFIRMED', 'Please confirm your email first. Check your inbox, or resend the confirmation email.'],
  ['AuthApiError: email not confirmed', 'AUTH_ERR_EMAIL_NOT_CONFIRMED', 'Please confirm your email first. Check your inbox, or resend the confirmation email.'],
  ['User is banned', 'AUTH_ERR_SUSPENDED', 'This account has been suspended. Contact support if you believe this is a mistake.'],
  ['User is banned until 2099-01-01T00:00:00Z', 'AUTH_ERR_SUSPENDED', 'This account has been suspended. Contact support if you believe this is a mistake.'],
  ['New password should be different from the old password.', 'AUTH_ERR_SAME_PASSWORD', 'That is already your current password.'],
  ['Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.', 'AUTH_ERR_PASSWORD_POLICY', 'That password does not meet the requirements. Use at least 12 characters with an uppercase letter, a lowercase letter and a number.'],
  ['Password should be at least 12 characters.', 'AUTH_ERR_PASSWORD_POLICY', 'That password does not meet the requirements. Use at least 12 characters with an uppercase letter, a lowercase letter and a number.'],
];
const UNKNOWN = ['Invalid login credentials', 'Network request failed', 'Signups not allowed for this instance', ''];
type AuthFn = (m: string, t?: (k: string, v?: Record<string, string | number>) => string) => string;
function rowsT(lang: Lang) { return (k: string) => { const v = newRow(prodRows, k, lang); if (v === undefined) throw new Error(`no ${lang} row for ${k}`); return v; }; }

/** violations of rule (1) by `fn`; [] when it behaves as written */
function authViolations(fn: AuthFn): string[] {
  const v: string[] = [];
  for (const [msg, key, english] of KNOWN) {
    const bare = fn(msg); if (bare !== english) v.push(`no t: "${msg.slice(0, 30)}" -> "${bare}"`);
    const calls: string[] = []; const rec = (k: string) => { calls.push(k); return `<${k}>`; };
    const withT = fn(msg, rec); if (withT !== `<${key}>` || calls.join() !== key) v.push(`t stub: "${msg.slice(0, 30)}" -> ${withT} calls ${calls}`);
    for (const l of LANGS) { const lt = fn(msg, rowsT(l)); if (lt !== newRow(prodRows, key, l)) v.push(`${l}: "${msg.slice(0, 30)}" -> "${lt}"`); }
  }
  for (const msg of UNKNOWN) {
    let called = 0; const rec = (k: string) => { called++; return `<${k}>`; };
    if (fn(msg) !== msg) v.push(`unknown "${msg}" changed without t`);
    if (fn(msg, rec) !== msg || called) v.push(`unknown "${msg}" changed or called t with t`);
  }
  return v;
}
test('A1. friendlyAuthError: without t the old English exactly; with t the label text, in en / ko / zh / ru; unknown messages untouched', () => {
  assert.deepEqual(authViolations(friendlyAuthError as AuthFn), []);
  /* the English literals above are the PR's; the migration's en rows say the same text, so the two sources agree */
  for (const [, key, english] of KNOWN) assert.equal(newRow(prodRows, key, 'en'), english, `${key}: the en row and the old English text differ`);
});
test('A1-CONTROL. a function that ignores t, always calls t, translates without t, or rewrites an unknown message is flagged', () => {
  const src = read('lib/authErrors.ts');
  const build = (s: string) => load<{ friendlyAuthError: AuthFn }>(`${s.replace(/^import .*$/gm, '').replace(/^export /gm, '')}\nconst __x = { friendlyAuthError };`, '__x');
  assert.deepEqual(authViolations(build(src).friendlyAuthError), [], 'CONTROL: the cut real source must pass the checker');
  const mut = (from: string, to: string) => { assert.equal(src.split(from).length, 2, `CONTROL: mutation anchor not unique: ${from}`); return build(src.replace(from, () => to)).friendlyAuthError; };
  assert.ok(authViolations(mut('(t ? t(key) : en)', 'en')).length, 'a function that ignores t passed');
  assert.ok(authViolations(mut('(t ? t(key) : en)', 't ? t(key) : "\ud55c"')).length, 'a function that translates without t passed');
  assert.ok(authViolations(mut("'That is already your current password.'", "'That is already your password.'")).length, 'changed English passed');
  assert.ok(authViolations(mut('if (/banned/i.test(message)) {', 'if (/banned|invalid/i.test(message)) {')).length, 'rewriting an unknown message passed');
  assert.ok(authViolations(mut('/should be different from the old password/i', '/zzz/i')).length, 'the same-password rule lost its own message but passed');
});

const PAGES: Array<[string, number]> = [
  ['app/(main)/login/page.tsx', 5], ['app/(main)/forgot-password/page.tsx', 1], ['app/(main)/reset-password/page.tsx', 1], ['app/(main)/settings/page.tsx', 1], ['app/(main)/auth/callback/page.tsx', 3],
];
/** call-site violations of `name` in `src`: wrong count, a call whose last argument is not `lastArg`, or a call outside a function that declares t from useLabels */
function siteViolations(src: string, name: string, want: number, lastArg: string, scoped: boolean): string[] {
  const v: string[] = []; const calls = callArgs(src, name);
  if (calls.length !== want) v.push(`${calls.length} call(s) of ${name}, expected ${want}`);
  for (const a of calls) if (a.length !== 2 || a[1] !== lastArg) v.push(`${name}(${a.join(', ').slice(0, 50)}) does not end with ${lastArg}`);
  if (scoped) {
    const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g'); let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(0, m.index); const fnAt = Math.max(before.lastIndexOf('\nfunction '), before.lastIndexOf('\nexport default function '), before.lastIndexOf('\nasync function '));
      if (fnAt < 0 || !/const \{[^}]*\bt\b[^}]*\} = useLabels\(\)/.test(before.slice(fnAt))) v.push(`a ${name} call at char ${m.index} is outside a component that reads t from useLabels()`);
    }
  }
  return v;
}
function walk(dir: URL, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const u = new URL(n + (statSync(new URL(n, dir)).isDirectory() ? '/' : ''), dir); if (n === 'node_modules' || n === '.next') continue; if (u.pathname.endsWith('/')) walk(u, out); else if (/\.(ts|tsx)$/.test(n)) out.push(u.pathname); }
  return out;
}
test('A2. login (5), forgot-password (1), reset-password (1), settings (1), auth/callback (3): every friendlyAuthError call ends with t, and t is in scope', () => {
  for (const [f, n] of PAGES) assert.deepEqual(siteViolations(read(f), 'friendlyAuthError', n, 't', true), [], f);
  /* the five are ALL the callers: a sixth page that calls it with one argument keeps English for ko / zh / ru and nothing here would see it */
  const callers = ['app', 'components', 'lib'].flatMap((d) => walk(new URL(`../${d}/`, import.meta.url))).filter((p) => /friendlyAuthError\(/.test(readFileSync(p.replace(/^\/(?=[A-Za-z]:)/, ''), 'utf8')) && !/lib\/authErrors\.ts$/.test(p)).map((p) => p.replace(/^.*\/(app|components|lib)\//, '$1/')).sort();
  assert.deepEqual(callers, PAGES.map(([f]) => f).sort(), 'the set of pages that call friendlyAuthError changed');
  assert.ok(read('app/(main)/login/page.tsx').includes('`${friendlyAuthError(error.message, t)} Reason: ${j.reason}`'), 'the suspended "Reason:" line must go through t too');
});
test('A2-CONTROL. a one-argument call, a missing call, and a call outside the component that holds t are flagged', () => {
  const good = '\nfunction P() {\n  const { t } = useLabels();\n  const f = () => { setError(friendlyAuthError(error.message, t)); };\n}\n';
  assert.deepEqual(siteViolations(good, 'friendlyAuthError', 1, 't', true), []);
  assert.ok(siteViolations(good.replace(', t))', '))'), 'friendlyAuthError', 1, 't', true).length, 'a one-argument call passed');
  assert.ok(siteViolations(good, 'friendlyAuthError', 2, 't', true).length, 'a wrong count passed');
  assert.ok(siteViolations(good.replace('(error.message, t)', '(error.message, tt)'), 'friendlyAuthError', 1, 't', true).length, 'a wrong second argument passed');
  assert.ok(siteViolations('function A() {\n  const { t } = useLabels();\n}\nfunction B() {\n  setError(friendlyAuthError(m, t));\n}\n', 'friendlyAuthError', 1, 't', true).length, 'a call in a component without t passed');
  assert.deepEqual(callArgs('x(a, [b, c], f(d, e))', 'x'), [['a', '[b, c]', 'f(d, e)']], 'CONTROL: the argument splitter');
});

/* ═════════════════════════ M. the migration ═════════════════════════ */
test('M1. 20261128b: 23 keys x en / ko / zh / ru = 92 rows in PROD and DEV, same placeholders, no vendor, no legal key, additive only', () => {
  assert.deepEqual(migViolations(migRaw, defaults, LABEL_KEYS), []);
  const prod = migBlocks.find((b) => b.table === 'lhq_labels')!;
  assert.equal(prod.rows.length, 92); assert.equal(NEW_KEYS.length, 23, 'CONTROL: the key list is the PR\'s 23');
  /* shaped like the neighbour: the upsert tail, the held header and the block order are 20261128a's */
  const nb = read('supabase/migrations/20261128a_labels_ko_zh_ru_untranslated.sql');
  assert.ok(/^-- NOT YET APPLIED TO ANY DATABASE\. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx\./.test(nb) && migRaw.split('\n')[0].slice(0, 160) === nb.split('\n')[0].slice(0, 160), 'the held header is not the neighbour\'s');
  assert.deepEqual(blocksOf(nb).map((b) => b.table), ['lhq_labels', 'lhq_dev_labels'], 'CONTROL: the neighbour is PROD then DEV');
  assert.deepEqual(migBlocks.map((b) => b.table), ['lhq_labels', 'lhq_dev_labels']);
  assert.ok(migRaw.indexOf('-- ===================== PROD =====================') < migRaw.indexOf('insert into lhq_labels') && migRaw.indexOf('-- ===================== DEV =====================') < migRaw.indexOf('insert into lhq_dev_labels'), 'the PROD / DEV banners do not sit above their blocks');
  /* the script of each language, and no value left equal to English (the defect class the PR exists to remove) */
  const script: Record<string, RegExp> = { ko: /[\uAC00-\uD7A3]/, zh: /[\u4E00-\u9FFF]/, ru: /[\u0400-\u04FF]/ };
  for (const r of prod.rows) {
    if (r.locale === 'en') continue;
    assert.match(r.value, script[r.locale], `${r.key}/${r.locale} has no ${r.locale} script: "${r.value}"`);
    assert.notEqual(r.value, newRow(prod.rows, r.key, 'en'), `${r.key}/${r.locale} equals English`);
    const latin = (r.value.replace(/\{\w+\}/g, '').match(/[A-Za-z]+/g) ?? []).filter((w) => !/^push$/i.test(w));
    assert.deepEqual(latin, [], `${r.key}/${r.locale} carries Latin words: ${latin}`);
  }
});
test('M1-CONTROL. each planted defect in the migration text is flagged by the same checker', () => {
  const plant = (from: string | RegExp, to: string, why: string) => { const out = migRaw.replace(from as string, () => to); assert.notEqual(out, migRaw, `CONTROL: plant did not apply: ${why}`); assert.ok(migViolations(out, defaults, LABEL_KEYS).length, `${why}: not flagged`); };
  assert.deepEqual(migViolations(migRaw, defaults, LABEL_KEYS), [], 'CONTROL: the real file is clean');
  plant("('BRIEFING_AGO_HM','ko','{h}시간 {m}분 전'),\n", '', 'a dropped ko row (91 rows)');
  plant("('BRIEFING_AGO_HM','ko','{h}시간 {m}분 전')", "('BRIEFING_AGO_HM','ko','{h}시간 분 전')", 'a lost {m}');
  plant("('CHAT_HISTORY_MESSAGES','zh','{n} 条消息')", "('CHAT_HISTORY_MESSAGES','zh','{ n } 条消息')", 'a malformed placeholder');
  plant("('OFFLINE_PAGE_TITLE','ru','Нет подключения')", "('OFFLINE_PAGE_TITLE','ru','')", 'an empty value');
  plant("('OFFLINE_PAGE_BODY','ko','다시 연결하면 실시간 데이터 피드가 재개됩니다.')", "('OFFLINE_PAGE_BODY','ko','Grok 다시 연결하면')", 'a vendor name');
  plant("('FUNDING_PAGE_LOADING','en','Loading funding rates…')", "('FUNDING_PAGE_LOADING','en','Loading rates')", 'an en row that differs from the default');
  plant(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);\n\n-- =====================\s+DEV/.exec(migRaw)![0], 'on conflict (key, locale) do update set value = excluded.value, updated_at = now();\n\ndelete from lhq_labels where key = \'X\';\n-- ===================== DEV', 'a delete statement');
  plant('-- ===================== DEV =====================\ninsert into lhq_dev_labels (key, locale, value) values\n(\'AUTH_ERR_EMAIL_NOT_CONFIRMED\',\'en\'', '-- ===================== DEV =====================\ninsert into lhq_dev_labels (key, locale, value) values\n(\'AUTH_ERR_EMAIL_NOT_CONFIRMED\',\'ko\',\'x\'),\n(\'AUTH_ERR_EMAIL_NOT_CONFIRMED\',\'en\'', 'a DEV block that differs from PROD');
  plant('-- NOT YET APPLIED TO ANY DATABASE.', '-- applied.', 'a missing held header');
  assert.ok(migViolations(migRaw, defaults, LABEL_KEYS.filter((k) => k !== 'OFFLINE_PAGE_TITLE')).length, 'a key missing from LABEL_KEYS passed');
  const d2 = { ...defaults }; delete d2.OFFLINE_PAGE_BODY; assert.ok(migViolations(migRaw, d2, LABEL_KEYS).length, 'a key missing from labelDefaults.en.json passed');
  const legal = migRaw.replace("'AUTH_ERR_SUSPENDED','en'", () => "'TERMS_SECTION_THIRD_PARTY_DATA_BODY','en'"); assert.ok(migViolations(legal, defaults, LABEL_KEYS).length, 'a legal key passed');
});

/* ═════════════════════════ D. the landing dictionaries ═════════════════════════ */
type FooterDict = { footer: { links: Record<string, string>; riskTitle: string; ack: string } };
const ALL_DICTS: Record<string, FooterDict> = { en: dEn, ko: dKo, zh: dZh, ru: dRu, ar: dAr } as unknown as Record<string, FooterDict>;
const DSCRIPT: Record<string, RegExp> = { ko: /[\uAC00-\uD7A3]/, zh: /[\u4E00-\u9FFF]/, ru: /[\u0400-\u04FF]/, ar: /[\u0600-\u06FF]/ };
function ackViolations(ds: Record<string, FooterDict>): string[] {
  const v: string[] = [];
  for (const [l, d] of Object.entries(ds)) {
    const ack = d?.footer?.ack;
    if (typeof ack !== 'string') { v.push(`${l}: no footer.ack`); continue; }
    for (const slot of ['{disclaimer}', '{terms}', '{privacy}']) if (ack.split(slot).length !== 2) v.push(`${l}: ack has ${ack.split(slot).length - 1} of ${slot}`);
    const parts = ack.split(/(\{disclaimer\}|\{terms\}|\{privacy\})/);
    if (parts.join('') !== ack || parts.filter((p) => /^\{\w+\}$/.test(p)).length !== 3) v.push(`${l}: the split LandingTerminal runs does not give three slots`);
    if (ack.replace(/\{\w+\}/g, '').replace(/[\s,.,、。و]/g, '').length < 8) v.push(`${l}: ack has no sentence around the slots`);
    for (const k of ['terms', 'privacy', 'contact']) if (!d.footer.links?.[k]?.trim()) v.push(`${l}: links.${k} empty`);
    if (!d.footer.riskTitle?.trim()) v.push(`${l}: riskTitle empty`);
    if (l !== 'en') {
      for (const [k, val] of [['ack', ack], ['riskTitle', d.footer.riskTitle], ['terms', d.footer.links?.terms], ['privacy', d.footer.links?.privacy], ['contact', d.footer.links?.contact]] as const) {
        if (val && !DSCRIPT[l].test(val)) v.push(`${l}: ${k} has no ${l} script`);
        const enVal = k === 'ack' ? ds.en.footer.ack : k === 'riskTitle' ? ds.en.footer.riskTitle : ds.en.footer.links[k];
        if (val === enVal) v.push(`${l}: ${k} equals English`);
      }
    }
  }
  return v;
}
test('D1. every landing locale carries footer.ack with {disclaimer} {terms} {privacy}, riskTitle and links.terms / privacy / contact', () => {
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'ko', 'ru', 'zh'], 'CONTROL: the shipped locale map');
  assert.deepEqual(ackViolations(ALL_DICTS), []);
  /* the locales the map serves are a subset of what was checked; ar is exported and checked but is not in the map (RTL not offered, #138), so no visitor reaches its footer today */
  for (const l of Object.keys(dictionaries)) assert.ok(l in ALL_DICTS);
  assert.equal(dEn.footer.ack, 'By using LiquidityHQ, you acknowledge that you understand and agree to our {disclaimer}, {terms}, and {privacy}.', 'the English sentence is the one the page showed before the PR');
  assert.deepEqual(ALL_DICTS.en.footer.links.terms + '|' + ALL_DICTS.en.footer.links.privacy + '|' + ALL_DICTS.en.footer.links.contact + '|' + ALL_DICTS.en.footer.riskTitle, 'Terms of Use|Privacy Policy|Contact|Risk disclosure', 'the English words are the ones that were hardcoded');
});
test('D1-CONTROL. a locale without a slot, with a doubled slot, an empty link, English left in, or no ack at all is flagged', () => {
  const clone = (): Record<string, FooterDict> => JSON.parse(JSON.stringify(ALL_DICTS));
  const mut = (f: (d: Record<string, FooterDict>) => void, why: string) => { const d = clone(); f(d); assert.ok(ackViolations(d).length, `${why}: not flagged`); };
  assert.deepEqual(ackViolations(clone()), [], 'CONTROL: the clone is clean');
  mut((d) => { d.ru.footer.ack = d.ru.footer.ack.replace('{privacy}', ''); }, 'ru without {privacy}');
  mut((d) => { d.ko.footer.ack = d.ko.footer.ack.replace('{terms}', '{terms}{terms}'); }, 'ko with {terms} twice');
  mut((d) => { d.zh.footer.links.contact = ''; }, 'zh empty contact');
  mut((d) => { d.ar.footer.riskTitle = d.en.footer.riskTitle; }, 'ar riskTitle left English');
  mut((d) => { delete (d.ru.footer as { ack?: string }).ack; }, 'ru without ack');
  mut((d) => { d.ko.footer.ack = 'LiquidityHQ {disclaimer}{terms}{privacy}'; }, 'ko ack in English');
});
test('D2. LandingTerminal reads the dictionary for the footer words and builds the ack as three working links; the disclaimer paragraph and the six disclosure bodies stay English (PM)', () => {
  const s = read('components/LandingTerminal.tsx');
  assert.match(s, /dict\.footer\.ack\.split\(\/\(\\\{disclaimer\\\}\|\\\{terms\\\}\|\\\{privacy\\\}\)\/\)/, 'the ack is no longer split on its three slots');
  for (const [href, key] of [['/disclaimer', 'disclaimer'], ['/terms', 'terms'], ['/privacy', 'privacy'], ['/contact', 'contact']] as const) assert.ok(s.includes(`['${href}', dict.footer.links.${key}]`) || s.includes(`href="${href}"`) && s.includes(`dict.footer.links.${key}`), `${href} is not wired to dict.footer.links.${key}`);
  assert.ok(s.includes('{dict.footer.riskTitle}'), 'the "Risk disclosure" heading is not read from the dictionary');
  assert.doesNotMatch(s, /'Terms of Use'|'Privacy Policy'|>Risk disclosure<|>Disclaimer<\/Link>|>Terms of Use<|>Privacy Policy<|>Contact<\/Link>|you acknowledge that you understand/, 'a footer word is hardcoded in English again');
  /* the premise of "stays English on purpose": these six labels and the paragraphs are literals in the component, so they are English in every locale, and the file still reads no labels */
  for (const lbl of ['Educational Use', 'Trading Risk', 'No Investment Advice', 'AI Analysis', 'Data Sources', 'No Affiliation']) assert.ok(s.includes(`label: '${lbl}'`), `the disclosure heading "${lbl}" moved: the "stays English" premise changed`);
  assert.doesNotMatch(s, /useLabels/, 'the landing terminal now reads the labels provider (landingReadsNoLabels owns that rule)');
  /* the split, run on every locale, gives the slot order that locale wrote and every slot maps to a real href */
  const slots = (ack: string) => ack.split(/(\{disclaimer\}|\{terms\}|\{privacy\})/).filter((p) => /^\{\w+\}$/.test(p));
  assert.deepEqual(slots(dEn.footer.ack), ['{disclaimer}', '{terms}', '{privacy}']);
  for (const l of ['ko', 'zh', 'ru', 'ar']) assert.deepEqual(slots(ALL_DICTS[l].footer.ack).sort(), ['{disclaimer}', '{privacy}', '{terms}'], l);
});

/* ═════════════════════════ E. global-error and the two screens ═════════════════════════ */
type Copy = Record<string, { title: string; body: string; again: string; dir?: string }>;
const geSrc = read('app/global-error.tsx');
function loadCopy(src: string): Copy {
  const s = src.indexOf('const COPY'); assert.ok(s >= 0, 'CONTROL: COPY not found');
  const head = /const COPY[^=]*=\s*\{/.exec(src.slice(s))!; const open = s + head[0].length - 1;
  let d = 0; let q = ''; let end = -1;
  for (let i = open; i < src.length; i++) { const c = src[i]; if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; } if (c === "'" || c === '"' || c === '`') { q = c; continue; } if (c === '{') d++; else if (c === '}' && --d === 0) { end = i; break; } }
  return load<Copy>(`${src.slice(s, end + 1)};`, 'COPY');
}
function copyViolations(c: Copy): string[] {
  const v: string[] = []; const want = ['ar', 'en', 'ko', 'ru', 'zh'];
  if (JSON.stringify(Object.keys(c).sort()) !== JSON.stringify(want)) v.push(`locales ${Object.keys(c).sort()} vs ${want}`);
  const keys = (o: object) => Object.keys(o).filter((k) => k !== 'dir').sort().join();
  for (const l of want) {
    const e = c[l]; if (!e) continue;
    if (keys(e) !== 'again,body,title') v.push(`${l}: keys ${keys(e)}`);
    for (const k of ['title', 'body', 'again'] as const) { if (typeof e[k] !== 'string' || !e[k].trim()) v.push(`${l}.${k} empty`); else if (l !== 'en' && e[k] === c.en?.[k]) v.push(`${l}.${k} equals English`); else if (l !== 'en' && !DSCRIPT[l].test(e[k])) v.push(`${l}.${k} has no ${l} script`); }
    if ((l === 'ar') !== (e.dir === 'rtl')) v.push(`${l}: dir ${e.dir} (only ar is rtl)`);
  }
  return v;
}
test('E1. global-error COPY (cut from the real file): en / ko / zh / ru / ar, the same three keys, each in its own script, ar rtl; the stored language drives it', () => {
  const copy = loadCopy(geSrc);
  assert.deepEqual(copyViolations(copy), []);
  assert.deepEqual(copy.en, { title: 'Something went wrong', body: 'Try reloading the page. If this keeps happening, please try again in a few minutes.', again: 'Try again' }, 'the English text changed from what the screen said before the PR');
  /* the language read: the key global-error reads is the key the app writes, and a stored value without an entry stays English */
  const labelsSrc = read('lib/labels.ts');
  assert.match(labelsSrc, /const LS_KEY = 'lhq_lang_v1'/, 'the app stores the language under another key than global-error reads');
  assert.ok(geSrc.includes("localStorage.getItem('lhq_lang_v1')"), 'global-error does not read lhq_lang_v1');
  /* RE-PINNED 2026-11-20 for #2738 (QA finding 3, fixed by Dev): the guard is an OWN-key test, so a stored 'constructor' / '__proto__' cannot pick an inherited property and render a blank screen */
  const line = /try \{ const l = localStorage\.getItem\('lhq_lang_v1'\); if \(l && Object\.hasOwn\(COPY, l\)\) setLang\(l\); \} catch \{[^}]*\}/.exec(geSrc); assert.ok(line, 'the language-read line changed (it must be an own-key test, not COPY[l]): re-pin');
  const pick = (stored: string | null | 'THROW') => { let lang = 'en'; const localStorage = { getItem: () => { if (stored === 'THROW') throw new Error('blocked'); return stored; } }; new Function('localStorage', 'COPY', 'setLang', line![0])(localStorage, copy, (l: string) => { lang = l; }); return lang; };
  assert.deepEqual(['ko', 'zh', 'ru', 'ar', 'en'].map((l) => pick(l)), ['ko', 'zh', 'ru', 'ar', 'en']);
  for (const other of [null, '', 'vi', 'pt-BR', 'tr', 'es', 'id', 'THROW', 'constructor', '__proto__', 'toString', 'hasOwnProperty'] as const) assert.equal(pick(other), 'en', `stored ${other} must read English`);
  assert.ok(geSrc.includes('<html lang={lang} dir={c.dir}>') && geSrc.includes('{c.title}') && geSrc.includes('{c.body}') && geSrc.includes('{c.again}'), 'the screen does not render the chosen entry');
  assert.doesNotMatch(geSrc, />\s*(Something went wrong|Try again)\s*</, 'an English literal is rendered again');
});
test('E1-CONTROL. a COPY without ar, with a missing key, an empty value, English left in a language, or ar not rtl is flagged', () => {
  const real = loadCopy(geSrc); const clone = (): Copy => JSON.parse(JSON.stringify(real));
  assert.deepEqual(copyViolations(clone()), [], 'CONTROL: the clone is clean');
  const mut = (f: (c: Copy) => void, why: string) => { const c = clone(); f(c); assert.ok(copyViolations(c).length, `${why}: not flagged`); };
  mut((c) => { delete c.ar; }, 'no ar');
  mut((c) => { delete (c.ko as { again?: string }).again; }, 'ko without again');
  mut((c) => { c.ru.body = ' '; }, 'ru empty body');
  mut((c) => { c.zh.title = c.en.title; }, 'zh title left English');
  mut((c) => { delete c.ar.dir; }, 'ar not rtl');
  mut((c) => { c.ko.dir = 'rtl'; }, 'ko rtl');
  mut((c) => { (c as Record<string, unknown>).xx = c.en; }, 'an extra locale');
});
test('E2. /offline and the /funding loading screen read their labels (client components under the labels provider)', () => {
  const off = read('app/(main)/offline/page.tsx'); const fl = read('app/(main)/funding/loading.tsx');
  for (const [name, s] of [['offline', off], ['funding/loading', fl]] as const) { assert.match(s, /^'use client';/, `${name}: not a client component, useLabels would fail`); assert.match(s, /const \{ t \} = useLabels\(\);/, `${name}: no t`); }
  assert.ok(off.includes("{t('OFFLINE_PAGE_TITLE')}") && off.includes("{t('OFFLINE_PAGE_BODY')}"), 'offline does not read its two keys');
  assert.ok(fl.includes("message={t('FUNDING_PAGE_LOADING')}") && fl.includes('fullPage'), 'funding loading does not read its key into the full-page state');
  assert.doesNotMatch(off, /You&apos;re offline|Reconnect to resume/, 'offline renders English again'); assert.doesNotMatch(fl, /Loading funding rates/, 'funding loading renders English again');
  assert.match(read('components/AppShell.tsx'), /<LabelsProvider>\s*<AuthProvider>\{children\}<\/AuthProvider>\s*<\/LabelsProvider>/, 'AppShell does not wrap the pages in LabelsProvider'); assert.match(read('components/RootDocument.tsx'), /<AppShell/, 'the (main) root does not mount AppShell');
  assert.equal(newRow(prodRows, 'OFFLINE_PAGE_TITLE', 'en'), "You're offline", 'the en row is not the apostrophe text the page showed');
  assert.ok(read('app/(main)/settings/page.tsx').includes("alert(t('SETTINGS_PUSH_UNSUPPORTED'))") && read('app/(main)/settings/page.tsx').includes("alert(t('SETTINGS_PUSH_UNAVAILABLE'))"), 'the settings push alerts do not read their keys');
  assert.doesNotMatch(read('app/(main)/settings/page.tsx'), /VAPID key missing|alert\('Push/, 'the settings page still alerts in English / names VAPID');
  assert.equal(newRow(prodRows, 'SETTINGS_PUSH_UNAVAILABLE', 'en'), 'Push notifications are not available right now.');
});

/* ═════════════════════════ T. relative times ═════════════════════════ */
const SRC = { briefing: read('components/BriefingTerminal.tsx'), chat: read('components/GrokChat.tsx'), ticker: read('components/NewsTicker.tsx'), provider: read('components/NewsProvider.tsx'), ms: read('components/MarketStructure.tsx') };
type T = (k: string, v?: Record<string, string | number>) => string;
type Fns = {
  tsAgo: (ts: number, t: T) => string; relTime: (ts: number, t: T) => string; tickerAgo: (ts: number, t: T) => string; providerAgo: (ts: number, t: T) => string;
  countdown: (h: number, t: T) => string; fmtAge: (n: number, t: T) => string; hToHM: (h: number) => string;
  briefLabel: (t: T, mins: number) => string; yen: (t: T, m: number) => string; eventRow: (t: T, isPast: boolean, lh: number) => string; upcoming: (t: T, e: { name: string; h: number }) => string;
};
function buildFns(s: typeof SRC): Fns {
  const hToHM = load<(h: number) => string>(cutBlock(s.briefing, 'function hToHM('), 'hToHM');
  const hToHMt = load<(h: number, t: T) => string>(cutBlock(s.briefing, 'function hToHMt('), 'hToHMt'); // RE-PINNED 2026-11-20 for #2741
  const countdown = load<Fns['countdown']>(cutBlock(s.provider, 'function countdown('), 'countdown');
  const lineOf = (src: string, needle: string) => { const i = src.indexOf(needle); assert.ok(i >= 0, `CONTROL: anchor not found: ${needle}`); const a = src.lastIndexOf('\n', i) + 1; return src.slice(a, src.indexOf('\n', i)); };
  const brief = lineOf(s.briefing, 'const label = mins < 1 ?').trim().replace(/^const label = /, '').replace(/;$/, '');
  const yenLine = lineOf(s.briefing, 'BRIEFING_YEN_UPDATED'); const yenX = yenLine.slice(yenLine.indexOf('time: ') + 6, yenLine.lastIndexOf(' })}'));
  const evLine = lineOf(s.briefing, "isPast ? t('ALERTS_AGO_MINUTES'").trim().replace(/^\{/, '').replace(/\}$/, '');
  const upI = s.provider.indexOf("tRef.current('NEWS_UPCOMING_ALERT'"); assert.ok(upI >= 0, 'CONTROL: the upcoming-alert call moved');
  const upX = s.provider.slice(upI, s.provider.indexOf(", 'Calendar'", upI));
  const f1 = expr(brief, ['t', 'mins']); const f2 = expr(yenX, ['t', 'jpyMinutesAgo']); const f3 = expr(evLine, ['t', 'isPast', 'lh', 'hToHMt']); const f4 = expr(upX, ['tRef', 'e', 'countdown']);
  return {
    tsAgo: load(cutBlock(s.briefing, 'function tsAgo('), 'tsAgo'), relTime: load(cutBlock(s.chat, 'function relTime('), 'relTime'), tickerAgo: load(cutBlock(s.ticker, 'function timeAgo('), 'timeAgo'),
    providerAgo: load(cutBlock(s.provider, 'function timeAgo('), 'timeAgo'), countdown, fmtAge: load(cutBlock(s.ms, 'function fmtAge('), 'fmtAge'), hToHM,
    briefLabel: (t, mins) => f1(t, mins), yen: (t, m) => f2(t, m), eventRow: (t, p, lh) => f3(t, p, lh, hToHMt), upcoming: (t, e) => f4({ current: t }, e, countdown),
  };
}
/* label text per language: the new keys from the migration, the existing ALERTS_AGO_* / NEWS_TIME_* from the migrations that seeded them (ko, zh) and from the English defaults; ru has no repo row for those two families */
const seedRow = (file: string, key: string, l: string) => new RegExp(`\\('${key}','${l}','((?:[^']|'')*)'\\)`).exec(read(`supabase/migrations/${file}`))?.[1];
const EXISTING = ['ALERTS_AGO_JUST_NOW', 'ALERTS_AGO_MINUTES', 'ALERTS_AGO_HOURS', 'ALERTS_AGO_DAYS', 'NEWS_TIME_JUST_NOW', 'NEWS_TIME_MINUTES_AGO', 'NEWS_TIME_HOURS_AGO', 'NEWS_TIME_DAYS_AGO'];
function labelT(l: Lang): T {
  return (k, v) => {
    let raw: string | undefined;
    if (l === 'en') raw = defaults[k];
    else if (NEW_KEYS.includes(k)) raw = newRow(prodRows, k, l);
    else if (k.startsWith('BRIEFING_DUR_')) raw = newRow(batch3Rows, k, l); // RE-PINNED 2026-11-20 for #2741: the duration units come from 20261128c
    else if (EXISTING.includes(k)) raw = l === 'ko' ? seedRow('20260731a_labels_seed_translation_ko.sql', k, 'ko') : l === 'zh' ? seedRow('20260801a_labels_seed_translation_zh.sql', k, 'zh') : undefined;
    else raw = undefined;
    return raw === undefined ? `<<no ${l} row: ${k}>>` : interpolate(raw, v ?? {});
  };
}
const recT: T = (k, v) => (v && Object.keys(v).length ? `${k}${JSON.stringify(v)}` : k);

/* [label, how to call it, literal input, expected per language]; ru is null where the text comes from an existing key with no repo row (its ROUTING is pinned in the recorder table below) */
type Case = { id: string; run: (f: Fns, t: T) => string; routed: string; text: Partial<Record<Lang, string>> };
const AGE = (s: number) => NOW / 1000 - s;
const CASES: Case[] = [
  { id: 'tsAgo 30 s', run: (f, t) => f.tsAgo(AGE(30), t), routed: 'ALERTS_AGO_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'tsAgo 60 s (1 min)', run: (f, t) => f.tsAgo(AGE(60), t), routed: 'ALERTS_AGO_MINUTES{"n":1}', text: { en: '1m ago', ko: '1분 전', zh: '1分钟前' } },
  { id: 'tsAgo 120 s (2 min)', run: (f, t) => f.tsAgo(AGE(120), t), routed: 'ALERTS_AGO_MINUTES{"n":2}', text: { en: '2m ago', ko: '2분 전', zh: '2分钟前' } },
  { id: 'tsAgo 3540 s (59 min)', run: (f, t) => f.tsAgo(AGE(3540), t), routed: 'ALERTS_AGO_MINUTES{"n":59}', text: { en: '59m ago', ko: '59분 전', zh: '59分钟前' } },
  { id: 'tsAgo 3600 s (1 h exactly)', run: (f, t) => f.tsAgo(AGE(3600), t), routed: 'ALERTS_AGO_HOURS{"n":1}', text: { en: '1h ago', ko: '1시간 전', zh: '1小时前' } },
  { id: 'tsAgo 3660 s (1 h 1 m)', run: (f, t) => f.tsAgo(AGE(3660), t), routed: 'BRIEFING_AGO_HM{"h":1,"m":1}', text: { en: '1h 1m ago', ko: '1시간 1분 전', zh: '1 小时 1 分钟前', ru: '1 ч 1 мин назад' } },
  { id: 'tsAgo 7380 s (2 h 3 m)', run: (f, t) => f.tsAgo(AGE(7380), t), routed: 'BRIEFING_AGO_HM{"h":2,"m":3}', text: { en: '2h 3m ago', ko: '2시간 3분 전', zh: '2 小时 3 分钟前', ru: '2 ч 3 мин назад' } },
  { id: 'tsAgo 90000 s (25 h, no day tier)', run: (f, t) => f.tsAgo(AGE(90000), t), routed: 'ALERTS_AGO_HOURS{"n":25}', text: { en: '25h ago', ko: '25시간 전', zh: '25小时前' } },
  { id: 'relTime 30 s', run: (f, t) => f.relTime((NOW - 30_000), t), routed: 'ALERTS_AGO_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'relTime 1 min', run: (f, t) => f.relTime(NOW - 60_000, t), routed: 'ALERTS_AGO_MINUTES{"n":1}', text: { en: '1m ago', ko: '1분 전', zh: '1分钟前' } },
  { id: 'relTime 5 min', run: (f, t) => f.relTime(NOW - 300_000, t), routed: 'ALERTS_AGO_MINUTES{"n":5}', text: { en: '5m ago', ko: '5분 전', zh: '5分钟前' } },
  { id: 'relTime 1 h', run: (f, t) => f.relTime(NOW - 3_600_000, t), routed: 'ALERTS_AGO_HOURS{"n":1}', text: { en: '1h ago', ko: '1시간 전', zh: '1小时前' } },
  { id: 'relTime 23 h', run: (f, t) => f.relTime(NOW - 23 * 3_600_000, t), routed: 'ALERTS_AGO_HOURS{"n":23}', text: { en: '23h ago', ko: '23시간 전', zh: '23小时前' } },
  { id: 'relTime 24 h (1 day)', run: (f, t) => f.relTime(NOW - 24 * 3_600_000, t), routed: 'ALERTS_AGO_DAYS{"n":1}', text: { en: '1d ago', ko: '1일 전', zh: '1天前' } },
  { id: 'relTime 6 days', run: (f, t) => f.relTime(NOW - 6 * 86_400_000, t), routed: 'ALERTS_AGO_DAYS{"n":6}', text: { en: '6d ago', ko: '6일 전', zh: '6天前' } },
  { id: 'ticker timeAgo 59 s', run: (f, t) => f.tickerAgo(AGE(59), t), routed: 'NEWS_TIME_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'ticker timeAgo 60 s', run: (f, t) => f.tickerAgo(AGE(60), t), routed: 'NEWS_TIME_MINUTES_AGO{"n":1}', text: { en: '1m ago', ko: '1분 전', zh: '1分钟前' } },
  { id: 'ticker timeAgo 3599 s', run: (f, t) => f.tickerAgo(AGE(3599), t), routed: 'NEWS_TIME_MINUTES_AGO{"n":59}', text: { en: '59m ago', ko: '59분 전', zh: '59分钟前' } },
  { id: 'ticker timeAgo 3600 s', run: (f, t) => f.tickerAgo(AGE(3600), t), routed: 'NEWS_TIME_HOURS_AGO{"n":1}', text: { en: '1h ago', ko: '1시간 전', zh: '1小时前' } },
  { id: 'ticker timeAgo 90000 s (no day tier)', run: (f, t) => f.tickerAgo(AGE(90000), t), routed: 'NEWS_TIME_HOURS_AGO{"n":25}', text: { en: '25h ago', ko: '25시간 전', zh: '25小时前' } },
  { id: 'provider timeAgo 30 s', run: (f, t) => f.providerAgo(AGE(30), t), routed: 'NEWS_TIME_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'provider timeAgo 7200 s', run: (f, t) => f.providerAgo(AGE(7200), t), routed: 'NEWS_TIME_HOURS_AGO{"n":2}', text: { en: '2h ago', ko: '2시간 전', zh: '2小时前' } },
  { id: 'countdown -1 h', run: (f, t) => f.countdown(-1, t), routed: 'NEWS_COUNTDOWN_PASSED', text: { en: 'Just passed', ko: '방금 지남', zh: '刚刚结束', ru: 'Только что прошло' } },
  { id: 'countdown 0.2 h', run: (f, t) => f.countdown(0.2, t), routed: 'NEWS_COUNTDOWN_NOW', text: { en: 'Happening NOW', ko: '지금 진행 중', zh: '正在进行', ru: 'Идёт сейчас' } },
  { id: 'countdown 1 h', run: (f, t) => f.countdown(1, t), routed: 'NEWS_COUNTDOWN_HOURS{"n":1}', text: { en: '1h away', ko: '1시간 후', zh: '1 小时后', ru: 'через 1 ч' } },
  { id: 'countdown 5.4 h', run: (f, t) => f.countdown(5.4, t), routed: 'NEWS_COUNTDOWN_HOURS{"n":5}', text: { en: '5h away', ko: '5시간 후', zh: '5 小时后', ru: 'через 5 ч' } },
  { id: 'countdown 24 h', run: (f, t) => f.countdown(24, t), routed: 'NEWS_COUNTDOWN_DAYS_ONLY{"d":1}', text: { en: '1d away', ko: '1일 후', zh: '1 天后', ru: 'через 1 дн' } },
  { id: 'countdown 49 h', run: (f, t) => f.countdown(49, t), routed: 'NEWS_COUNTDOWN_DAYS{"d":2,"r":1}', text: { en: '2d 1h away', ko: '2일 1시간 후', zh: '2 天 1 小时后', ru: 'через 2 дн 1 ч' } },
  { id: 'fmtAge 0', run: (f, t) => f.fmtAge(0, t), routed: 'MARKET_STRUCTURE_AGO_CURRENT', text: { en: 'current', ko: '현재', zh: '当前', ru: 'сейчас' } },
  { id: 'fmtAge 1 candle (4 h)', run: (f, t) => f.fmtAge(1, t), routed: 'MARKET_STRUCTURE_AGO_H{"h":4}', text: { en: '~4h ago', ko: '약 4시간 전', zh: '约 4 小时前', ru: '~4 ч назад' } },
  { id: 'fmtAge 5 candles (20 h)', run: (f, t) => f.fmtAge(5, t), routed: 'MARKET_STRUCTURE_AGO_H{"h":20}', text: { en: '~20h ago', ko: '약 20시간 전', zh: '约 20 小时前', ru: '~20 ч назад' } },
  { id: 'fmtAge 6 candles (1 d exactly)', run: (f, t) => f.fmtAge(6, t), routed: 'MARKET_STRUCTURE_AGO_D{"d":1}', text: { en: '~1d ago', ko: '약 1일 전', zh: '约 1 天前', ru: '~1 дн назад' } },
  { id: 'fmtAge 7 candles (1 d 4 h)', run: (f, t) => f.fmtAge(7, t), routed: 'MARKET_STRUCTURE_AGO_DH{"d":1,"r":4}', text: { en: '~1d 4h ago', ko: '약 1일 4시간 전', zh: '约 1 天 4 小时前', ru: '~1 дн 4 ч назад' } },
  { id: 'brief cached 0 min', run: (f, t) => f.briefLabel(t, 0), routed: 'ALERTS_AGO_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'brief cached 5 min', run: (f, t) => f.briefLabel(t, 5), routed: 'ALERTS_AGO_MINUTES{"n":5}', text: { en: '5m ago', ko: '5분 전', zh: '5分钟前' } },
  { id: 'brief cached 61 min', run: (f, t) => f.briefLabel(t, 61), routed: 'ALERTS_AGO_HOURS{"n":1}', text: { en: '1h ago', ko: '1시간 전', zh: '1小时前' } },
  { id: 'yen 0 min', run: (f, t) => f.yen(t, 0), routed: 'ALERTS_AGO_JUST_NOW', text: { en: 'just now', ko: '방금', zh: '刚刚' } },
  { id: 'yen 89 min', run: (f, t) => f.yen(t, 89), routed: 'ALERTS_AGO_MINUTES{"n":89}', text: { en: '89m ago', ko: '89분 전', zh: '89分钟前' } },
  { id: 'yen 90 min (rounds to 2 h)', run: (f, t) => f.yen(t, 90), routed: 'ALERTS_AGO_HOURS{"n":2}', text: { en: '2h ago', ko: '2시간 전', zh: '2小时前' } },
  { id: 'yen 2880 min (2 d)', run: (f, t) => f.yen(t, 2880), routed: 'ALERTS_AGO_DAYS{"n":2}', text: { en: '2d ago', ko: '2일 전', zh: '2天前' } },
  { id: 'event row past 30 min', run: (f, t) => f.eventRow(t, true, -0.5), routed: 'ALERTS_AGO_MINUTES{"n":30}', text: { en: '30m ago', ko: '30분 전', zh: '30分钟前' } },
  { id: 'event row now', run: (f, t) => f.eventRow(t, false, 0.01), routed: 'BRIEFING_EVENT_NOW', text: { en: 'NOW', ko: '지금', zh: '现在', ru: 'СЕЙЧАС' } },
  { id: 'event row in 2 h 30 m', run: (f, t) => f.eventRow(t, false, 2.5), routed: 'BRIEFING_EVENT_IN{"time":"BRIEFING_DUR_HM{\\"h\\":2,\\"m\\":30}"}', text: { en: 'in 2h 30m', ko: '2시간 30분 후', zh: '2 小时 30 分钟后', ru: 'через 2 ч 30 мин' } }, // RE-PINNED 2026-11-20 for #2741
  { id: 'upcoming alert, happening now', run: (f, t) => f.upcoming(t, { name: 'FOMC', h: 0.4 }), routed: 'NEWS_UPCOMING_ALERT{"name":"FOMC","countdown":"NEWS_COUNTDOWN_NOW"}', text: { en: 'Upcoming: FOMC - Happening NOW', ko: '예정: FOMC - 지금 진행 중', zh: '即将发生：FOMC - 正在进行', ru: 'Скоро: FOMC - Идёт сейчас' } },
  { id: 'upcoming alert, 1 h away', run: (f, t) => f.upcoming(t, { name: 'CPI', h: 0.9 }), routed: 'NEWS_UPCOMING_ALERT{"name":"CPI","countdown":"NEWS_COUNTDOWN_HOURS{\\"n\\":1}"}', text: { en: 'Upcoming: CPI - 1h away', ko: '예정: CPI - 1시간 후', zh: '即将发生：CPI - 1 小时后', ru: 'Скоро: CPI - через 1 ч' } },
];
/** mismatches of the real functions against the pinned table: key routing (recorder) and rendered text per language */
function timeViolations(f: Fns): string[] {
  const v: string[] = [];
  /* the recorder names the key and variables; nested t calls (the upcoming alert's countdown) come back as their own recorder text */
  for (const c of CASES) {
    let got = ''; try { got = c.run(f, recT); } catch (e) { got = `threw ${(e as Error).message}`; } if (got !== c.routed) v.push(`${c.id}: routes ${got}, expected ${c.routed}`);
    for (const l of LANGS) { const want = c.text[l]; if (want === undefined) continue; let txt = ''; try { txt = c.run(f, labelT(l)); } catch (e) { txt = `threw ${(e as Error).message}`; } if (txt !== want) v.push(`${c.id} [${l}]: "${txt}", expected "${want}"`); }
  }
  return v;
}
test('T1. the relative-time functions, CUT FROM THE REAL SOURCES, give the pinned text for literal ages in en / ko / zh / ru and route to the right key', () => {
  const f = buildFns(SRC);
  assert.deepEqual(timeViolations(f), []);
  /* the day tier of relTime stops at 7 days and then prints a date (not a label): no label call, the same date the browser formats */
  const calls: string[] = []; const spy: T = (k) => { calls.push(k); return k; };
  assert.equal(f.relTime(NOW - 7 * 86_400_000, spy), new RealDate(NOW - 7 * 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); assert.deepEqual(calls, [], 'a week-old chat row called a label');
  /* ko / zh / ru never print an English unit word where a label produced the text, except the hh:mm helper, which is pinned as it is */
  for (const c of CASES) for (const l of ['ko', 'zh', 'ru'] as const) { const w = c.text[l]; if (w === undefined) continue; /* RE-PINNED 2026-11-20 for #2741: the event row's English-unit exemption is gone (hToHMt translates the units) */ assert.doesNotMatch(w, /\b(ago|away|in|just now|NOW|current)\b/, `${c.id} [${l}] still reads English: ${w}`); }
  assert.equal(f.hToHM(2.5), '2h 30m', 'hToHM output (the "h" / "m" in it are English units, untouched by the PR)'); assert.equal(f.hToHM(0.5), '30m'); assert.equal(f.hToHM(3), '3h');
  assert.equal(CASES.filter((c) => c.text.ru).length > 15, true, 'CONTROL: ru is pinned for the new keys');
});
test('T1-CONTROL. a function that sends minutes to the hours key, swaps a variable, reverts to English or loses a branch is flagged', () => {
  assert.deepEqual(timeViolations(buildFns(SRC)), [], 'CONTROL: the real functions pass');
  const m = (file: keyof typeof SRC, from: string, to: string, why: string) => {
    assert.equal(SRC[file].split(from).length, 2, `CONTROL: mutation anchor not unique in ${file}: ${from}`);
    assert.ok(timeViolations(buildFns({ ...SRC, [file]: SRC[file].replace(from, () => to) })).length, `${why}: not flagged`);
  };
  m('briefing', "t('ALERTS_AGO_MINUTES', { n: m })", "t('ALERTS_AGO_MINUTES', { n: h })", 'tsAgo minutes variable');
  m('briefing', "t('BRIEFING_AGO_HM', { h, m: rm })", "t('BRIEFING_AGO_HM', { h: rm, m: h })", 'tsAgo h / m swapped');
  m('briefing', "t('ALERTS_AGO_HOURS', { n: Math.floor(mins / 60) })", "`${Math.floor(mins / 60)}h ago`", 'brief cached reverts to English');
  m('briefing', "t('ALERTS_AGO_DAYS', { n: Math.round(jpyMinutesAgo / 1440) })", "t('ALERTS_AGO_HOURS', { n: Math.round(jpyMinutesAgo / 1440) })", 'yen days tier');
  m('briefing', "t('BRIEFING_EVENT_NOW')", "'NOW'", 'event row NOW reverts to English');
  m('chat', "t('ALERTS_AGO_DAYS', { n: dy })", "t('ALERTS_AGO_DAYS', { n: h })", 'relTime days variable');
  m('chat', "if (m < 60) return t('ALERTS_AGO_MINUTES', { n: m });", "if (m < 60) return `${m}m ago`;", 'relTime minutes reverts to English');
  m('ticker', "t('NEWS_TIME_MINUTES_AGO', { n: Math.floor(s / 60) })", "t('NEWS_TIME_MINUTES_AGO', { n: Math.floor(s / 3600) })", 'ticker minutes variable');
  m('ticker', "return t('NEWS_TIME_HOURS_AGO', { n: Math.floor(s / 3600) });", "return Math.floor(s / 3600) + 'h ago';", 'ticker hours reverts to English');
  m('provider', "t('NEWS_TIME_JUST_NOW')", "'just now'", 'provider just now reverts to English');
  m('provider', "return r ? t('NEWS_COUNTDOWN_DAYS', { d, r }) : t('NEWS_COUNTDOWN_DAYS_ONLY', { d });", "return t('NEWS_COUNTDOWN_DAYS', { d, r });", 'countdown loses the days-only branch');
  m('provider', "t('NEWS_COUNTDOWN_NOW')", "t('NEWS_COUNTDOWN_PASSED')", 'countdown NOW / PASSED swapped');
  m('provider', "countdown: countdown(e.h, tRef.current)", "countdown: ''", 'upcoming alert loses its countdown');
  m('ms', "t('MARKET_STRUCTURE_AGO_DH', { d, r })", "t('MARKET_STRUCTURE_AGO_D', { d })", 'fmtAge loses the hours');
  m('ms', "t('MARKET_STRUCTURE_AGO_H', { h })", "`~${h}h ago`", 'fmtAge reverts to English');
});
test('T2. every call of the time helpers passes t; the alert source id and the stable pushAlert are as written', () => {
  const need = (src: string, name: string, n: number, last: string) => assert.deepEqual(siteViolations(src, name, n, last, false), [], name);
  need(SRC.briefing, 'tsAgo', 2, 't'); need(SRC.chat, 'relTime', 1, 't'); need(SRC.ticker, 'timeAgo', 1, 't'); need(SRC.ms, 'fmtAge', 2, 't');
  need(SRC.provider, 'timeAgo', 1, 'tRef.current'); need(SRC.provider, 'countdown', 1, 'tRef.current');
  assert.match(SRC.ticker, /\[sorted, t\]\);/, 'the ticker text memo does not depend on t: a language change would not re-render it');
  assert.ok(SRC.provider.includes("'Calendar', Math.floor(Date.now() / 1000), 'amber')"), "the upcoming alert's source id 'Calendar' changed (the code compares it)");
  assert.match(SRC.provider, /const tRef = useRef\(t\);\n\s*tRef\.current = t;/, 'NewsProvider does not read t through a ref');
  assert.equal(/const pushAlert = useCallback\([\s\S]*?\n  \}, (\[[^\]]*\])\);/.exec(SRC.provider)?.[1], '[]', 'pushAlert has dependencies again (it would rebuild on a language change)');
  assert.ok(SRC.chat.includes("t('CHAT_HISTORY_MESSAGES', { n: c.messages.length })"), 'the chat history row does not read its message-count key');
  assert.doesNotMatch(SRC.chat + SRC.briefing + SRC.ms + SRC.ticker, /\bjust now'|\}m ago`|\}h ago`|\}d ago`|'m ago'|'h ago'/, 'an English relative-time literal is back');
  assert.match(SRC.briefing, /mb-event-time[\s\S]{0,300}isPast \? t\('ALERTS_AGO_MINUTES'/, 'the event row moved');
});
test('T2-CONTROL. a call without t, a wrong count and a wrong second argument are flagged', () => {
  assert.deepEqual(siteViolations('a(tsAgo(e.ts, t), tsAgo(w.ts, t))', 'tsAgo', 2, 't', false), []);
  assert.ok(siteViolations('a(tsAgo(e.ts), tsAgo(w.ts, t))', 'tsAgo', 2, 't', false).length, 'a one-argument call passed');
  assert.ok(siteViolations('a(tsAgo(e.ts, t))', 'tsAgo', 2, 't', false).length, 'a missing call passed');
  assert.ok(siteViolations('a(timeAgo(ts, t))', 'timeAgo', 1, 'tRef.current', false).length, 'the provider calling with a stale t passed');
});
