import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* #2318, migration 20261114p: push subscriptions are written by the SERVER only. QA's pin.
 *
 * WHAT THIS PINS: both project blocks revoke INSERT and UPDATE on the push subscriptions table from anon AND authenticated (so a signed-in user with the public anon key cannot store an
 * endpoint that skips lib/pushEndpoint.ts), the table-wide `for all` grant is not given back anywhere in a later migration, the subscribe route writes through the service role only,
 * and no browser code touches the table.
 *
 * WHAT IT CANNOT PROVE: that the migration RAN. Measured separately on dev (has_table_privilege): anon none of SELECT/INSERT/UPDATE/DELETE; authenticated SELECT only; service_role all four.
 * A refused direct insert over HTTP as a signed-in user is the live check; this file pins the source. */

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const MIG = 'supabase/migrations/20261114p_push_subscriptions_server_writes_only.sql';
const sql = read(MIG);
const sqlCode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const prodBlock = sqlCode.slice(0, sqlCode.indexOf('lhq_dev_push_subscriptions')).split('\n').filter((l) => l.includes('lhq_push_subscriptions')).join('\n');
const devBlock = sqlCode.split('\n').filter((l) => l.includes('lhq_dev_push_subscriptions')).join('\n');

test('P1. each block revokes INSERT and UPDATE from anon and authenticated', () => {
  for (const [name, block, table] of [['prod', prodBlock, 'lhq_push_subscriptions'], ['dev', devBlock, 'lhq_dev_push_subscriptions']] as const) {
    assert.ok(block.includes(`revoke insert, update on public.${table} from anon, authenticated;`), `${name}: INSERT/UPDATE are not revoked from anon and authenticated`);
    assert.ok(block.includes(`revoke select, delete on public.${table} from anon;`), `${name}: anon keeps SELECT or DELETE`);
  }
});

test('P2. nothing in the file grants a write back, and no later migration grants one on the table', () => {
  assert.equal(/\bgrant\b/i.test(sqlCode), false, 'the migration itself grants something');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql') && n > '20261114p').sort()) {
    const body = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const m of body.matchAll(/grant\s+[^;]*?on\s+(?:table\s+)?(?:public\.)?(lhq_(?:dev_)?push_subscriptions)\b[^;]*;/gi)) assert.equal(/\b(insert|update|all)\b/i.test(m[0]), false, `${f}: ${m[0]}`);
  }
});

test('P3. the only writers are server routes on the service role; no browser code names the table', () => {
  const route = read('app/api/push/subscribe/route.ts');
  assert.ok(/getSupabaseAdmin\(\)/.test(route) && /admin\.from\(T\.push_subscriptions\)\.upsert\(/.test(route), 'the subscribe route does not write through the service role');
  assert.equal(/userClient\(/.test(route.slice(route.indexOf('T.push_subscriptions') - 200, route.indexOf('T.push_subscriptions') + 400)), false, 'the write goes through a user client');
  const offenders: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(n)) { const s = readFileSync(p, 'utf8'); if (/push_subscriptions/.test(s) && /'use client'|"use client"/.test(s)) offenders.push(p.split('\\').join('/')); } } };
  for (const d of ['app', 'components', 'hooks']) { try { walk(d); } catch { /* absent */ } }
  assert.deepEqual(offenders, [], 'a client component names the push subscriptions table');
});
