/* QA: PR #2809 (#1632 owner item 21), the public browser key keeps SELECT on public content only.
 *   G1 each block (prod, dev) revokes SELECT from anon on exactly these 19 tables, once each, on its own project's table names
 *   G2 the file does nothing else: no grant, no other role, no other statement; the five public-content tables are not touched
 *   G3 /live-tracking shows the empty list on "not allowed" (42501) and still shows any other error
 *   G4 the journal, the one browser read of a revoked table that runs on mount, stays behind the sign-in gate
 * WHAT IT CANNOT PROVE: the grants on a database. After the migration is applied the read-back queries in the file are run on that project. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261130e_anon_select_public_content_only.sql');
const TABLES = ['ai_call_log', 'alert_fires', 'alert_grok_log', 'app_config', 'clusters', 'global_ai_usage', 'grok_usage', 'hypotheses', 'hypothesis_evidence', 'live_signals', 'muted_alerts', 'price_alerts', 'signals', 'trades', 'trial_claims', 'user_onboarding', 'user_settings', 'user_status', 'user_subscriptions'];
const at = sql.indexOf('-- ── dev:');
const statements = (part: string) => part.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'));

test('G1. prod and dev each revoke anon SELECT on exactly the 19 tables', () => {
  assert.ok(at > 0, 'CONTROL: the dev block marker is gone');
  assert.equal(TABLES.length, 19);
  for (const [part, prefix] of [[sql.slice(0, at), 'lhq_'], [sql.slice(at), 'lhq_dev_']] as const) {
    assert.deepEqual(statements(part), TABLES.map((t) => `revoke select on public.${prefix}${t} from anon;`), `${prefix} block`);
  }
});

test('G2. nothing else runs, and public content is not touched', () => {
  const all = statements(sql);
  assert.equal(all.length, 38);
  for (const s of all) assert.match(s, /^revoke select on public\.lhq_(dev_)?[a-z_]+ from anon;$/, s);
  for (const t of ['labels', 'news', 'econ_snapshot', 'market_snapshot', 'liq_events']) assert.equal(all.some((s) => new RegExp(`lhq_(dev_)?${t} `).test(s)), false, `${t} lost its public read`);
});

test('G3. /live-tracking treats "not allowed" as an empty list and still reports other errors', () => {
  assert.match(read('app/(main)/live-tracking/page.tsx'), /if \(err\?\.code === '42501'\) setRows\(\[\]\);\n\s*else if \(err\) setError\(/);
});

test('G4. the journal reads its table only behind the sign-in gate', () => {
  assert.match(read('components/TradeJournal.tsx'), /export default function TradeJournal\(\) \{[\s\S]{0,200}<AuthGate[\s\S]{0,400}<Inner \/>[\s\S]{0,120}<\/AuthGate>/);
  assert.match(read('components/AuthGate.tsx'), /if \(!user\) \{/);
});
