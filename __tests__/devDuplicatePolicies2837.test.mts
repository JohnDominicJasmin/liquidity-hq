/* QA: PR #2837 (owner item 53), the held DEV-only migration that drops the second copy of two access policies. Source checks only: it is not applied.
 *   P1 dev tables only, in one transaction, nothing created, altered, granted or deleted
 *   P2 exactly the two dev copies are dropped, each only after the policy being kept was found, and both kept names match the earlier migrations */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const raw = readFileSync(new URL('20261130l_dev_drop_duplicate_hypothesis_policies.sql', dir), 'utf8').replace(/\r\n/g, '\n');
const sql = raw.replace(/--[^\n]*/g, '').toLowerCase();

test('P1. dev only, one transaction, drops nothing else', () => {
  assert.equal(/\blhq_(?!dev_)/.test(sql), false, 'a production table is named');
  assert.match(sql, /^\s*begin;[\s\S]*commit;\s*$/);
  assert.equal(/\b(create|alter|grant|revoke|truncate|insert|update|delete)\b|drop\s+(table|function|trigger|index)|disable row level security/.test(sql), false);
});

test('P2. the two copies go only when the kept policy is there', () => {
  assert.deepEqual([...sql.matchAll(/drop policy if exists "([a-z_]+)" on public\.([a-z_]+);/g)].map((m) => `${m[2]}:${m[1]}`), ['lhq_dev_hypotheses:owner_all_dev_hypotheses', 'lhq_dev_hypothesis_evidence:owner_all_dev_evidence']);
  assert.equal(sql.split('drop policy').length - 1, 2);
  for (const [table, kept] of [['lhq_dev_hypotheses', 'owner_all_hypotheses'], ['lhq_dev_hypothesis_evidence', 'owner_all_evidence']]) {
    const guard = sql.indexOf(`tablename = '${table}' and policyname = '${kept}'`);
    assert.ok(guard > 0 && guard < sql.indexOf('drop policy'), `${kept}: no guard before the drops`);
    assert.ok(sql.slice(guard, guard + 300).includes('raise exception'), kept);
    const earlier = readdirSync(dir).filter((f) => f.startsWith('20260907b')).map((f) => readFileSync(new URL(f, dir), 'utf8').toLowerCase()).join('\n');
    assert.ok(earlier.includes(kept), `${kept}: not created by 20260907b`);
  }
});
