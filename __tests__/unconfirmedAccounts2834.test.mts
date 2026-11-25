/* QA: PR #2834 (owner item 20): accounts left unconfirmed for a day are removed. IT DELETES ACCOUNTS: every doubt must keep the account. The real lib runs against a stand-in admin client.
 *   A1 each eligibility rule on its own keeps the account; exactly 24 h is kept, a millisecond more is not
 *   A2 a row in any of the account's own tables keeps it (the list is written out here, not read from the code)
 *   A3 a subscription row that is not the untouched sign-up row keeps it
 *   A4 a failed read, or a count that does not come back, removes nothing
 *   A5 confirmed between the listing and the delete: kept, and its trial claim is left alone
 *   A6 the account's own trial claim goes first (so signing up again gets a trial); if it cannot go the account stays; nobody else's claim is touched
 *   A7 a dry run changes nothing; one run removes at most 500; the second page of accounts is read */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleUnconfirmed, purgeUnconfirmedAccounts, UNCONFIRMED_AFTER_MS, type AdminClient, type AuthAccount } from '../lib/unconfirmedAccounts.ts';

const NOW = Date.parse('2026-11-25T04:00:00Z'), DAY = 86_400_000;
const stale = (id: string, extra: Partial<AuthAccount> = {}): AuthAccount => ({ id, created_at: new Date(NOW - 2 * DAY).toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, ...extra });
type Row = Record<string, unknown>;
const OWN: Array<[string, string]> = [['user_settings', 'user_id'], ['user_onboarding', 'user_id'], ['user_status', 'user_id'], ['muted_alerts', 'user_id'], ['price_alerts', 'user_id'], ['push_subscriptions', 'user_id'], ['telegram_link_codes', 'user_id'],
  ['trades', 'user_id'], ['hypotheses', 'user_id'], ['hypothesis_evidence', 'user_id'], ['grok_usage', 'user_id'], ['ai_call_log', 'user_id'], ['admin_users', 'user_id'], ['admin_audit_log', 'target_user_id']];

function world(users: AuthAccount[], tables: Record<string, Row[]> = {}) {
  const w = { users, tables, log: [] as string[], fail: '' as string, noCount: '' as string, confirmOnReread: '' as string };
  const err = { message: 'stand-in: down' };
  const admin = {
    auth: { admin: {
      listUsers: async ({ page, perPage }: { page: number; perPage: number }) => (w.fail === 'list' ? { data: { users: [] }, error: err } : { data: { users: w.users.slice((page - 1) * perPage, page * perPage) }, error: null }),
      getUserById: async (id: string) => { const u = w.users.find((x) => x.id === id); return { data: { user: u && w.confirmOnReread === id ? { ...u, email_confirmed_at: new Date(NOW).toISOString() } : u ?? null }, error: null }; },
      deleteUser: async (id: string) => { w.log.push(`account ${id}`); w.users = w.users.filter((x) => x.id !== id); return { error: null }; },
    } },
    from: (table: string) => {
      const name = table.replace(/^lhq_(dev_)?/, ''); const rows = () => w.tables[name] ?? [];
      const answer = (col: string, ids: string[], head: boolean) => {
        if (w.fail === name) return { data: null, count: null, error: err };
        const hit = rows().filter((r) => ids.includes(r[col] as string));
        return { data: head ? null : hit, count: w.noCount === name ? null : hit.length, error: null };
      };
      return {
        select: (_c: string, o?: { head?: boolean }) => ({ in: async (col: string, ids: string[]) => answer(col, ids, !!o?.head), eq: async (col: string, id: string) => answer(col, [id], !!o?.head) }),
        delete: () => ({ eq: async (col: string, id: string) => { if (w.fail === `delete ${name}`) return { error: err }; w.log.push(`delete ${name} ${col}=${id}`); w.tables[name] = rows().filter((r) => r[col] !== id); return { error: null }; } }),
      };
    },
  } as unknown as AdminClient;
  return { w, run: (opts: { dryRun?: boolean } = {}) => purgeUnconfirmedAccounts(admin, { nowMs: NOW, ...opts }) };
}
const signupRow = (id: string, extra: Row = {}): Row => ({ user_id: id, role: 'free', trial_ends_at: new Date(NOW + 12 * DAY).toISOString(), updated_at: new Date(NOW).toISOString(), trial_reminder_sent_at: null, plan: null, ...extra });

test('A1. each rule on its own keeps the account', () => {
  assert.equal(isStaleUnconfirmed(stale('a'), NOW), true, 'CONTROL');
  const at = new Date(NOW - DAY).toISOString();
  for (const extra of [{ email_confirmed_at: at }, { phone_confirmed_at: at }, { confirmed_at: at }, { last_sign_in_at: at }, { invited_at: at }, { banned_until: at },
    { app_metadata: { provider: 'google', providers: ['google'] } }, { app_metadata: { provider: 'email', providers: ['email', 'google'] } }, { app_metadata: {} }, { app_metadata: null }, { created_at: null }, { created_at: 'not a date' }] as Array<Partial<AuthAccount>>)
    assert.equal(isStaleUnconfirmed(stale('a', extra), NOW), false, JSON.stringify(extra));
  assert.equal(UNCONFIRMED_AFTER_MS, DAY);
  for (const [age, gone] of [[DAY - 1, false], [DAY, false], [DAY + 1, true]] as const) assert.equal(isStaleUnconfirmed(stale('a', { created_at: new Date(NOW - age).toISOString() }), NOW), gone, `${age}`);
});

test('A2. a row in any of its own tables keeps the account', async () => {
  for (const [table, column] of OWN) {
    const s = world([stale('kept'), stale('gone')], { [table]: [{ [column]: 'kept' }] });
    const r = await s.run();
    assert.deepEqual(s.w.users.map((u) => u.id), ['kept'], table);
    assert.deepEqual([r.removed, r.kept, r.failed], [1, 1, 0], table);
  }
});

test('A3. only the untouched sign-up row lets an account go', async () => {
  for (const extra of [{ role: 'pro' }, { role: 'trial' }, { plan: 'monthly' }, { ls_subscription_id: 'x' }, { current_period_end: new Date(NOW).toISOString() }, { anything_new: 0 }]) {
    const s = world([stale('a')], { user_subscriptions: [signupRow('a', extra)] });
    await s.run(); assert.equal(s.w.users.length, 1, JSON.stringify(extra));
  }
  const s = world([stale('a')], { user_subscriptions: [signupRow('a')] });
  assert.equal((await s.run()).removed, 1);
});

test('A4. a failed read or a missing count removes nothing', async () => {
  for (const [fail, noCount] of [['list', ''], ['user_subscriptions', ''], ...OWN.map(([t]) => [t, '']), ...OWN.map(([t]) => ['', t])] as Array<[string, string]>) {
    const s = world([stale('a')], { trial_claims: [{ first_user_id: 'a' }] }); s.w.fail = fail; s.w.noCount = noCount;
    await assert.rejects(s.run(), `${fail || noCount}: it carried on`);
    assert.deepEqual(s.w.log, [], fail || noCount);
  }
});

test('A5. confirmed between the listing and the delete: kept, claim and all', async () => {
  const s = world([stale('a')], { trial_claims: [{ first_user_id: 'a' }] }); s.w.confirmOnReread = 'a';
  const r = await s.run();
  assert.deepEqual([r.removed, r.failed, s.w.log.length, s.w.tables.trial_claims.length], [0, 0, 0, 1]);
});

test('A6. the account\'s own claim goes first; no claim removal, no account removal', async () => {
  const claims = () => [{ first_user_id: 'a' }, { first_user_id: 'someone-else' }, { first_user_id: null }];
  const s = world([stale('a')], { trial_claims: claims() });
  await s.run();
  assert.deepEqual(s.w.log, ['delete trial_claims first_user_id=a', 'account a']);
  assert.deepEqual(s.w.tables.trial_claims, claims().slice(1));
  const down = world([stale('a'), stale('b')]); down.w.fail = 'delete trial_claims';
  const r = await down.run();
  assert.deepEqual([r.removed, r.failed, down.w.users.length, down.w.log.length], [0, 2, 2, 0]);
});

test('A7. dry run changes nothing; 500 at most; the second page is read', async () => {
  const dry = world([stale('a')], { trial_claims: [{ first_user_id: 'a' }] });
  const d = await dry.run({ dryRun: true });
  assert.deepEqual([d.candidates, d.removed, dry.w.log.length], [1, 0, 0]);
  const many = world(Array.from({ length: 620 }, (_, i) => stale(`u${i}`)));
  const m = await many.run(); assert.deepEqual([m.candidates, m.removed, many.w.users.length], [620, 500, 120]);
  const paged = world([...Array.from({ length: 1000 }, (_, i) => stale(`c${i}`, { last_sign_in_at: new Date(NOW).toISOString() })), stale('page-two')]);
  await paged.run(); assert.equal(paged.w.users.some((u) => u.id === 'page-two'), false);
});
