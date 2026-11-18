/* QA's pin on the two migrations of #2567, read as text (no database):
 *   20261119p_labels_telegram_controls.sql  (13 label keys)
 *   20261119q_user_settings_alert_quiet.sql (5 columns on user_settings)
 * P1  the PROD block (lhq_labels) and the DEV block (lhq_dev_labels) hold the same 65 rows; every one of 13 keys has the 5 locales en ko zh ru ar, once
 * P2  every en value equals lib/labelDefaults.en.json; every key is in lib/labelKeys.ts; every {placeholder} of en is kept in the other four; no empty value, no angle bracket, no AI vendor name
 * P3  every key is used by components/TelegramQuietControls.tsx and every ALERTS_* key that component uses is a key of the migration or of the shipped defaults
 * Q1  additive only: only `add column if not exists`, `comment on column` and `grant`; no drop/alter type/not null/delete/update/truncate outside the commented rollback line
 * Q2  the five columns, with the right types; the hour columns carry a 0-23 check; every column is nullable with no default (old rows stay "not set")
 * Q3  grants: the four settings columns only, `to authenticated`, never anon or public, and telegram_lapse_notified_at (server-only) is NOT granted; every column /api/settings accepts is granted
 * Q4  the DEV block is commented out, names lhq_dev_user_settings and mirrors the PROD block statement for statement; the PROD block names lhq_user_settings only
 * Q5  every column the code reads or writes exists in the migration (a typo in a select would fail the whole read at run time)
 * WHAT IT CANNOT PROVE: that the SQL runs on the live schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const labelsSql = read('supabase/migrations/20261119p_labels_telegram_controls.sql');
const colsSql = read('supabase/migrations/20261119q_user_settings_alert_quiet.sql');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const keysSrc = read('lib/labelKeys.ts');
const component = read('components/TelegramQuietControls.tsx');
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];

const split = (sql: string) => { const i = sql.indexOf('===================== PROD'), j = sql.indexOf('===================== DEV'); assert.ok(i > 0 && j > i, 'PROD / DEV markers moved'); return { prod: sql.slice(i, j), dev: sql.slice(j) }; };
const rows = (s: string) => [...s.matchAll(/^\s*\('([A-Z0-9_]+)','(\w+)','((?:[^']|'')*)'\)/gm)].map((m) => ({ key: m[1], loc: m[2], val: m[3].replace(/''/g, "'") }));

test('P1. PROD and DEV label blocks are the same 65 rows: 13 keys x 5 locales, each once', () => {
  const { prod, dev } = split(labelsSql); const P = rows(prod), D = rows(dev);
  assert.match(prod, /insert into lhq_labels \(key, locale, value\)/); assert.match(dev, /insert into lhq_dev_labels \(key, locale, value\)/); assert.equal(/lhq_dev_labels/.test(prod), false); assert.equal(/\blhq_labels\b/.test(dev), false);
  assert.equal(P.length, 65); assert.deepEqual(D, P, 'the DEV rows differ from the PROD rows');
  const keys = [...new Set(P.map((r) => r.key))]; assert.equal(keys.length, 13);
  for (const k of keys) assert.deepEqual(P.filter((r) => r.key === k).map((r) => r.loc).sort(), [...LOCALES].sort(), `${k}: locales`);
  assert.equal((labelsSql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
});
test('P2. en equals the shipped defaults; every key is registered; placeholders are kept; no empty value, markup or vendor name', () => {
  const P = rows(split(labelsSql).prod); const ph = (s: string) => [...s.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((m) => m[0]).sort().join(',');
  for (const r of P) {
    if (r.loc === 'en') assert.equal(r.val, en[r.key], `${r.key}: en differs from labelDefaults.en.json`);
    assert.ok(keysSrc.includes(`'${r.key}'`), `${r.key} is not in lib/labelKeys.ts`);
    assert.equal(ph(r.val), ph(P.find((x) => x.key === r.key && x.loc === 'en')!.val), `${r.key}/${r.loc}: placeholders differ from en`);
    assert.ok(r.val.trim().length > 0, `${r.key}/${r.loc}: empty`); assert.doesNotMatch(r.val, /[<>]/, `${r.key}/${r.loc}: markup`); assert.doesNotMatch(r.val, /claude|anthropic|openai|gpt|gemini|grok|xai/i, `${r.key}/${r.loc}: vendor name`);
  }
  assert.ok(P.some((r) => /\{tz\}/.test(r.val)) && P.some((r) => /\{time\}/.test(r.val)), 'CONTROL: the placeholder check had placeholders to compare');
});
test('P3. the component uses every key and only known keys', () => {
  const keys = [...new Set(rows(split(labelsSql).prod).map((r) => r.key))]; for (const k of keys) assert.ok(component.includes(k), `${k} is not used by the component`);
  for (const m of component.matchAll(/ALERTS_[A-Z0-9_]+/g)) assert.ok(keys.includes(m[0]) || m[0] in en, `the component uses unknown ${m[0]}`);
});

const live = colsSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');           // statements outside comments
/** statements split on ; outside single-quoted text (the column comments contain semicolons) */
function statements(sql: string): string[] { const out: string[] = []; let cur = '', q = false; for (const ch of sql) { if (ch === "'") q = !q; if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean); }
const prodStmts = statements(live);
const devStmts = colsSql.split('\n').filter((l) => /^-- (alter|comment|grant) /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, '').replace(/\s+/g, ' ').trim());
const COLS: Record<string, string> = { alert_quiet_start: 'smallint', alert_quiet_end: 'smallint', alert_snooze_until: 'timestamptz', alert_paused: 'boolean', telegram_lapse_notified_at: 'timestamptz' };

test('Q1. additive only: add column if not exists, comment on column, grant', () => {
  for (const s of prodStmts) assert.match(s, /^(alter table lhq_user_settings add column if not exists |comment on column lhq_user_settings\.|grant insert \()/, `a statement that is not additive: ${s.slice(0, 90)}`);
  const bare = prodStmts.filter((x) => !x.startsWith('grant')).join(' ; ').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(bare, /\b(drop|truncate|delete|update|insert|rename|alter column|set not null|not null|default)\b/i, 'a destructive or defaulting clause is in the live SQL');
});
test('Q2. five columns, right types, 0-23 check on the hours, nullable, no default', () => {
  const adds = prodStmts.filter((s) => s.startsWith('alter table')); assert.equal(adds.length, 5);
  for (const [c, t] of Object.entries(COLS)) { const s = adds.find((a) => a.includes(` ${c} `))!; assert.ok(s, `${c} not added`); assert.match(s, new RegExp(`add column if not exists ${c} ${t}( check \\(${c} between 0 and 23\\))?$`), `${c}: ${s}`); }
  assert.equal(adds.filter((a) => /check/.test(a)).length, 2, 'only the two hour columns carry a check');
});
test('Q3. grants: the four settings columns to authenticated, never anon/public, the server-only mark is not granted, and everything /api/settings accepts is granted', () => {
  const grants = prodStmts.filter((s) => s.startsWith('grant')); assert.equal(grants.length, 1); const g = grants[0];
  assert.match(g, /^grant insert \(alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused\), update \(alert_quiet_start, alert_quiet_end, alert_snooze_until, alert_paused\) on public\.lhq_user_settings to authenticated$/);
  assert.doesNotMatch(live, /\b(anon|public\s*;|to public|service_role)\b/i); assert.equal(g.includes('telegram_lapse_notified_at'), false);
  const route = read('app/api/settings/route.ts'); const accepted = [...route.slice(route.indexOf('const ALLOWED'), route.indexOf('const payload')).matchAll(/'(alert_[a-z_]+|telegram_[a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(accepted.sort(), ['alert_paused', 'alert_quiet_end', 'alert_quiet_start', 'alert_snooze_until'], 'the settings allowlist and the grant disagree');
});
test('Q4. the DEV block is commented out, uses lhq_dev_user_settings and mirrors the PROD block', () => {
  assert.equal(/lhq_dev_user_settings/.test(live), false, 'the dev table is in the live SQL'); assert.equal(devStmts.length, prodStmts.length, 'dev block length differs');
  assert.deepEqual(devStmts.map((s) => s.replace(/lhq_dev_user_settings/g, 'lhq_user_settings')), prodStmts, 'the DEV block does not mirror the PROD block'); assert.ok(devStmts.every((s) => /lhq_dev_user_settings/.test(s)));
});
test('Q5. every settings column the code names exists in the migration', () => {
  const used = new Set<string>(); for (const rel of ['app/api/telegram/webhook/route.ts', 'lib/telegramAlertHolds.ts', 'lib/settings.ts', 'app/api/settings/route.ts', 'components/TelegramQuietControls.tsx']) for (const m of read(rel).matchAll(/\b(alert_(?:quiet_start|quiet_end|snooze_until|paused)|telegram_lapse_notified_at|alert_[a-z_]+)\b/g)) used.add(m[1]);
  const unknown = [...used].filter((c) => !(c in COLS)); assert.deepEqual(unknown, [], `the code names a column the migration does not create: ${unknown.join(', ')}`); assert.ok(used.size >= 5, 'CONTROL: the code references the columns');
});
