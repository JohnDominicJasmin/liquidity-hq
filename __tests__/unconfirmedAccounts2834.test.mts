/* QA: PR #2834 (owner item 20): accounts left unconfirmed for a day are removed. IT DELETES ACCOUNTS: every doubt must keep the account. The real lib runs against a stand-in admin client.
 *   A1 each eligibility rule on its own keeps the account; exactly 24 h is kept, a millisecond more is not
 *   A2 a row in any of the account's own tables keeps it (the list is written out here, not read from the code)
 *   A3 a subscription row that is not the untouched sign-up row keeps it
 *   A4 a failed read, or a count that does not come back, removes nothing
 *   A5 confirmed between the listing and the delete: kept, and its trial claim is left alone
 *   A6 (owner item 102) the sign-up row, then the account, then its claim; a refused delete puts the row back and keeps the claim; nobody else's claim is touched
 *   A7 a dry run changes nothing; one run removes at most 500; the second page of accounts is read
 * The stand-in behaves like the database in the two ways the removal depends on: an account with a subscription row cannot be deleted (dev has no cascade;
 * `cascade: true` is the other rule), and deleting an account blanks its id on the trial claim. #2851's first version missed the first of these. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleUnconfirmed, purgeUnconfirmedAccounts, UNCONFIRMED_AFTER_MS, type AdminClient, type AuthAccount } from '../lib/unconfirmedAccounts.ts';

const NOW = Date.parse('2026-11-25T04:00:00Z'), DAY = 86_400_000;
const stale = (id: string, extra: Partial<AuthAccount> = {}): AuthAccount => ({ id, created_at: new Date(NOW - 2 * DAY).toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, ...extra });
type Row = Record<string, unknown>;
const OWN: Array<[string, string]> = [['user_settings', 'user_id'], ['user_onboarding', 'user_id'], ['user_status', 'user_id'], ['muted_alerts', 'user_id'], ['price_alerts', 'user_id'], ['push_subscriptions', 'user_id'], ['telegram_link_codes', 'user_id'],
  ['trades', 'user_id'], ['hypotheses', 'user_id'], ['hypothesis_evidence', 'user_id'], ['grok_usage', 'user_id'], ['ai_call_log', 'user_id'], ['admin_users', 'user_id'], ['admin_audit_log', 'target_user_id']];

interface Chain { eq: (c: string, v: unknown) => Chain; in: (c: string, v: unknown[]) => Chain; is: (c: string, v: null) => Chain; then: (ok: (x: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise<unknown> }

function world(users: AuthAccount[], tables: Record<string, Row[]> = {}, o: { cascade?: boolean } = {}) {
  /* `fail` names one thing that is down: 'list', a table (its reads), 'one <table>' (only the read of a single account), 'delete <table>', 'insert <table>', 'delete account'. */
  const w = { users, tables, log: [] as string[], fail: [] as string[], noCount: '', confirmOnReread: '', changeOnReread: null as Row | null };
  const err = { message: 'stand-in: down' };
  const down = (what: string) => w.fail.includes(what);
  const admin = {
    auth: { admin: {
      listUsers: async ({ page, perPage }: { page: number; perPage: number }) => (down('list') ? { data: { users: [] }, error: err } : { data: { users: w.users.slice((page - 1) * perPage, page * perPage) }, error: null }),
      getUserById: async (id: string) => {
        const u = w.users.find((x) => x.id === id);
        if (w.changeOnReread) w.tables.user_subscriptions = (w.tables.user_subscriptions ?? []).map((r) => (r.user_id === id ? { ...r, ...w.changeOnReread } : r));
        return { data: { user: u && w.confirmOnReread === id ? { ...u, email_confirmed_at: new Date(NOW).toISOString() } : u ?? null }, error: null };
      },
      deleteUser: async (id: string) => {
        if (down('delete account')) return { error: err };
        if ((w.tables.user_subscriptions ?? []).some((r) => r.user_id === id)) {
          if (!o.cascade) return { error: { message: 'violates foreign key constraint' } };
          w.tables.user_subscriptions = w.tables.user_subscriptions.filter((r) => r.user_id !== id);
        }
        w.log.push(`account ${id}`); w.users = w.users.filter((x) => x.id !== id);
        if (w.tables.trial_claims) w.tables.trial_claims = w.tables.trial_claims.map((r) => (r.first_user_id === id ? { ...r, first_user_id: null } : r));
        return { error: null };
      },
    } },
    from: (table: string) => {
      const name = table.replace(/^lhq_(dev_)?/, ''); const rows = () => w.tables[name] ?? [];
      const query = (verb: 'select' | 'delete', head = false) => {
        const filters: Array<{ keep: (r: Row) => boolean; text: string; one: boolean }> = [];
        const run = () => {
          if (down(verb === 'delete' ? `delete ${name}` : name) || (verb === 'select' && down(`one ${name}`) && filters.some((f) => f.one))) return { data: null, count: null, error: err };
          const hit = rows().filter((r) => filters.every((f) => f.keep(r)));
          if (verb === 'delete') { w.log.push(`delete ${name} ${filters.map((f) => f.text).join(' & ')}`); w.tables[name] = rows().filter((r) => !hit.includes(r)); return { data: null, error: null }; }
          return { data: head ? null : hit.map((r) => ({ ...r })), count: w.noCount === name ? null : hit.length, error: null };
        };
        const add = (keep: (r: Row) => boolean, text: string, one = false) => { filters.push({ keep, text, one }); return chain; };
        const chain: Chain = {
          eq: (c, v) => add((r) => r[c] === v, `eq ${c}=${v}`, true),
          in: (c, v) => add((r) => v.includes(r[c]), `in ${c}=${v.join(',')}`),
          is: (c, v) => add((r) => (r[c] ?? null) === v, `is ${c}=${v}`),
          then: (ok: (x: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
        };
        return chain;
      };
      return {
        select: (_c: string, opts?: { head?: boolean }) => query('select', !!opts?.head),
        delete: () => query('delete'),
        insert: async (more: Row[]) => { if (down(`insert ${name}`)) return { error: err }; w.log.push(`insert ${name} ${more.map((r) => r.user_id).join(',')}`); w.tables[name] = [...rows(), ...more]; return { error: null }; },
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
    const s = world([stale('a')], { user_subscriptions: [signupRow('a', extra)] }, { cascade: true });
    await s.run(); assert.equal(s.w.users.length, 1, JSON.stringify(extra)); assert.deepEqual(s.w.log, [], JSON.stringify(extra));
  }
  const s = world([stale('a')], { user_subscriptions: [signupRow('a')] });
  assert.equal((await s.run()).removed, 1);
});

test('A4. a failed read or a missing count removes nothing', async () => {
  for (const [fail, noCount] of [['list', ''], ['user_subscriptions', ''], ...OWN.map(([t]) => [t, '']), ...OWN.map(([t]) => ['', t])] as Array<[string, string]>) {
    const s = world([stale('a')], { trial_claims: [{ first_user_id: 'a' }] }); s.w.fail = [fail]; s.w.noCount = noCount;
    await assert.rejects(s.run(), `${fail || noCount}: it carried on`);
    assert.deepEqual(s.w.log, [], fail || noCount);
  }
});

test('A5. confirmed between the listing and the delete: kept, claim and all', async () => {
  const s = world([stale('a')], { trial_claims: [{ first_user_id: 'a' }] }); s.w.confirmOnReread = 'a';
  const r = await s.run();
  assert.deepEqual([r.removed, r.failed, s.w.log.length, s.w.tables.trial_claims.length], [0, 0, 0, 1]);
});

const claims = (): Row[] => [{ normalized_email: 'a@x', first_user_id: 'a' }, { normalized_email: 'other@x', first_user_id: 'someone-else' }, { normalized_email: 'old@x', first_user_id: null }];
const full = (o: { cascade?: boolean } = {}) => world([stale('a')], { trial_claims: claims(), user_subscriptions: [signupRow('a'), signupRow('someone-else')] }, o);
const ROW_OUT = 'delete user_subscriptions eq user_id=a & eq role=free';

test('A6. the sign-up row, then the account, then its claim, under either database rule', async () => {
  for (const cascade of [false, true]) {
    const s = full({ cascade }); const r = await s.run();
    assert.deepEqual([r.removed, r.failed], [1, 0], `cascade=${cascade}`);
    assert.deepEqual(s.w.log, [ROW_OUT, 'account a', 'delete trial_claims in normalized_email=a@x & is first_user_id=null']);
    assert.deepEqual(s.w.tables.trial_claims, claims().slice(1), "only this account's claim; another blank one stays");
    assert.deepEqual(s.w.tables.user_subscriptions.map((x) => x.user_id), ['someone-else']);
  }
});

test('A6b. a refused delete puts the row back as it was and keeps the claim', async () => {
  const s = full(); s.w.fail = ['delete account']; const r = await s.run();
  assert.deepEqual([r.removed, r.failed, s.w.users.length], [0, 1, 1]);
  assert.deepEqual(s.w.log, [ROW_OUT, 'insert user_subscriptions a']);
  assert.deepEqual(s.w.tables.trial_claims, claims());
  assert.deepEqual(s.w.tables.user_subscriptions.find((x) => x.user_id === 'a'), signupRow('a'));
  const lost = full(); lost.w.fail = ['delete account', 'insert user_subscriptions'];
  const said: string[] = []; const real = console.error; console.error = (...a: unknown[]) => { said.push(a.join(' ')); };
  try { const l = await lost.run(); assert.deepEqual([l.removed, l.failed, lost.w.users.length], [0, 1, 1]); } finally { console.error = real; }
  assert.match(said.join(' '), /could not be put back/);
});

test('A6c. any step that fails before the delete leaves everything; a claim left behind is counted', async () => {
  for (const fail of ['trial_claims', 'one user_subscriptions', 'delete user_subscriptions']) {
    const s = full(); s.w.fail = [fail]; const r = await s.run();
    assert.deepEqual([r.removed, r.failed, s.w.users.length, s.w.log], [0, 1, 1, []], fail);
  }
  const left = full(); left.w.fail = ['delete trial_claims'];
  const real = console.error; console.error = () => {};
  try { const l = await left.run(); assert.deepEqual([l.removed, l.failed, left.w.users.length], [1, 1, 0]); } finally { console.error = real; }
  assert.deepEqual(left.w.tables.trial_claims[0], { normalized_email: 'a@x', first_user_id: null });
});

test('A6d. a row used between the listing and the removal keeps the account', async () => {
  const s = full({ cascade: true }); s.w.changeOnReread = { role: 'pro' }; const r = await s.run();
  assert.deepEqual([r.removed, r.failed, s.w.users.length, s.w.log], [0, 0, 1, []]);
});

test('A7. dry run changes nothing; 500 at most; the second page is read', async () => {
  const dry = full();
  const d = await dry.run({ dryRun: true });
  assert.deepEqual([d.candidates, d.removed, dry.w.log.length], [1, 0, 0]);
  const many = world(Array.from({ length: 620 }, (_, i) => stale(`u${i}`)));
  const m = await many.run(); assert.deepEqual([m.candidates, m.removed, many.w.users.length], [620, 500, 120]);
  const paged = world([...Array.from({ length: 1000 }, (_, i) => stale(`c${i}`, { last_sign_in_at: new Date(NOW).toISOString() })), stale('page-two')]);
  await paged.run(); assert.equal(paged.w.users.some((u) => u.id === 'page-two'), false);
});
