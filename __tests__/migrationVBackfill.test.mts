/* QA: the BACKFILL in migration 20261119v, run against a real SQL engine (node:sqlite, in-memory). The dev database holds 0 linked Telegram chats, so the SQL cannot prove itself there.
 * The SQL under test is READ FROM THE MIGRATION FILE (the prod block and, uncommented, the dev block) and translated by TEXT substitution only - every construct changed is listed in TRANSLATION below.
 * Seed: A linked, never muted | B linked, muted 'daily_summary' | C1 telegram_chat_id NULL, C2 '' , C3 '   ' (no linked chat) | D linked + already 'daily_summary_on' | E linked, muted some OTHER key.
 * LIMITATIONS (sqlite is not Postgres): NULL handling in NOT EXISTS is identical (it is a correlated anti-join; user_id is NOT NULL in the real table); btrim(x) is rtrim/ltrim in sqlite and trims only
 * spaces by default, as Postgres btrim does; text comparison here is case-sensitive like Postgres' default collation; the DO block / get diagnostics / raise notice are not executed (only the INSERT is). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
/* node:sqlite has no type declarations in this repo's @types/node: a small local shape, and a dynamic import whose specifier is a plain string so tsc does not resolve it. */
interface Db { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(): Array<Record<string, unknown>> } }
const { DatabaseSync } = (await import('node:' + 'sqlite')) as unknown as { DatabaseSync: new (path: string) => Db };

const sql = readFileSync(new URL('../supabase/migrations/20261119v_user_settings_daily_summary_hour.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The INSERT ... ON CONFLICT statement of the block, as written in the file. kind 'prod' reads the live lines, 'dev' strips the leading "-- " of the commented block. */
function insertOf(kind: 'prod' | 'dev'): string {
  const lines = sql.split('\n');
  const at = lines.findIndex((l) => /^-- ── dev:/.test(l));
  const block = kind === 'prod' ? lines.slice(0, at) : lines.slice(at + 1).map((l) => l.replace(/^-- ?/, ''));
  const text = block.join('\n');
  const m = /insert into public\.\w+ \(user_id, key\)[\s\S]*?on conflict \(user_id, key\) do nothing;/.exec(text);
  assert.ok(m, `no backfill INSERT found in the ${kind} block`);
  return m![0];
}
/** TRANSLATION (the only edits, both plain text substitutions): drop the "public." schema prefix; btrim( -> trim( (sqlite has no btrim; trim() with no 2nd arg strips spaces only, as Postgres btrim does). Everything else (<>, not exists, on conflict (user_id, key) do nothing) is valid sqlite as written. */
const toSqlite = (s: string) => s.replace(/public\./g, '').replace(/btrim\(/g, 'trim(');

const rows = (db: Db, p: string) => db.prepare(`select user_id, key from ${p}muted_alerts order by user_id, key`).all().map((r: Record<string, unknown>) => `${r.user_id}:${r.key}`);

for (const kind of ['prod', 'dev'] as const) {
  test(`BACKFILL ${kind}: exactly the unmuted linked users get one 'daily_summary_on' row; everyone else unchanged; run twice adds nothing`, () => {
    const p = kind === 'prod' ? 'lhq_' : 'lhq_dev_';
    const db = new DatabaseSync(':memory:');
    db.exec(`create table ${p}user_settings (user_id text primary key, telegram_chat_id text);   -- nullable here so the NULL case can be seeded (see NULL control below)
             create table ${p}muted_alerts (key text not null, user_id text not null, primary key (user_id, key));`);
    const us = db.prepare(`insert into ${p}user_settings values (?, ?)`); const ma = db.prepare(`insert into ${p}muted_alerts values (?, ?)`);
    us.run('A', '1001'); us.run('B', '1002'); us.run('C1', null); us.run('C2', ''); us.run('C3', '   '); us.run('D', '1004'); us.run('E', '1005'); us.run('F', ' 1006 ');
    ma.run('daily_summary', 'B'); ma.run('daily_summary_on', 'D'); ma.run('price_alerts', 'E'); ma.run('coin:btc', 'A');
    const before = rows(db, p);
    const stmt = toSqlite(insertOf(kind));
    assert.match(stmt, new RegExp(`from ${p}user_settings s`), 'CONTROL: the extracted statement reads the right project table');
    assert.match(stmt, new RegExp(`${p}muted_alerts m`), 'CONTROL: ...and anti-joins the right muted table');
    db.exec(stmt);
    const after1 = rows(db, p);
    const added1 = after1.filter((r) => !before.includes(r));
    assert.deepEqual(added1, ['A:daily_summary_on', 'E:daily_summary_on', 'F:daily_summary_on'], 'new rows after run 1 (A: linked, never muted; E: linked, muted only another key; F: padded id " 1006 " counts as linked)');
    assert.ok(!added1.some((r) => /^(B|C1|C2|C3):/.test(r)), 'B (muted daily_summary) and C* (no chat) must get nothing');
    assert.deepEqual(before.filter((r) => !after1.includes(r)), [], 'no pre-existing row was removed or changed');
    assert.equal(after1.filter((r) => r.startsWith('D:')).length, 1, 'D already had the row: still exactly one');
    db.exec(stmt);
    assert.deepEqual(rows(db, p), after1, 'second run added nothing (idempotent)');
  });
}

test('CONTROL: without the NOT EXISTS (mutation) B would be switched on - the assertion above can go red', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table lhq_user_settings (user_id text primary key, telegram_chat_id text); create table lhq_muted_alerts (key text not null, user_id text not null, primary key (user_id, key));
           insert into lhq_user_settings values ('B','1002'); insert into lhq_muted_alerts values ('daily_summary','B');`);
  const mutated = toSqlite(insertOf('prod')).replace(/and not exists \([^;]*?\)\s*on conflict/, 'on conflict');
  assert.notEqual(mutated, toSqlite(insertOf('prod')), 'the mutation changed the statement');
  db.exec(mutated);
  assert.ok(rows(db, 'lhq_').includes('B:daily_summary_on'), 'mutated SQL switches the muted user ON');
});

test('the backfill statement touches ONLY key daily_summary_on and never deletes or updates (read from the file)', () => {
  const s = insertOf('prod');
  assert.doesNotMatch(s, /\b(delete|update)\b/i);
  assert.equal((s.match(/'daily_summary_on'/g) ?? []).length, 1);
  assert.match(s, /m\.key = 'daily_summary'\)/, 'the anti-join checks the OLD key, exactly');
});
