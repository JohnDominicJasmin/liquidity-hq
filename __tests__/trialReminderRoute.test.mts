/* #2439: the trial-ending email goes only to a CONFIRMED, NOT-BANNED address, and the claim goes back when the send fails so the next run tries again.
 * THE REAL ROUTE RUNS (app/api/trial-reminder/route.ts GET) with a stand-in network: the subscriptions table (read, claim, claim release), the Auth admin lookup and Brevo. Every send is recorded.
 *   E1  a CONFIRMED address is mailed once and its claim stays set
 *   E2  an UNCONFIRMED address (someone else's address typed at sign-up) is NOT mailed and its claim stays FREE, so it is mailed once the address is confirmed
 *   E3  a BANNED account (banned_until in the future) is not mailed; a ban that has ended is
 *   E4  Brevo FAILS -> the claim goes back to null (the user is retried on the next run); a success afterwards sends once and keeps the claim
 *   E5  two runs: a claim already taken by another run is not sent twice
 * The welcome email (auth/welcome-email) has the same claim release: pinned as a source anchor W1, its route needs the signed-in token world. */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.CRON_SECRET = 'qa-cron-secret'; process.env.BREVO_API_KEY = 'placeholder-brevo'; process.env.BREVO_SENDER_EMAIL = 'sender@example.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const DAY = 86_400_000;
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333', U4 = '44444444-4444-4444-8444-444444444444', U5 = '55555555-5555-4555-8555-555555555555';

type Sub = { user_id: string; role: string; trial_ends_at: string; trial_reminder_sent_at: string | null };
type AuthUser = { id: string; email: string; email_confirmed_at: string | null; banned_until: string | null };
const db = { subs: new Map<string, Sub>(), users: new Map<string, AuthUser>(), brevo: [] as { to: string }[], brevoOk: true, stray: [] as string[] };
const reset = () => { db.subs.clear(); db.users.clear(); db.brevo = []; db.brevoOk = true; db.stray = []; };
const addUser = (id: string, over: Partial<AuthUser> = {}, subOver: Partial<Sub> = {}) => {
  db.users.set(id, { id, email: `${id}@example.test`, email_confirmed_at: new Date(Date.now() - 5 * DAY).toISOString(), banned_until: null, ...over });
  db.subs.set(id, { user_id: id, role: 'free', trial_ends_at: new Date(Date.now() + 1 * DAY).toISOString(), trial_reminder_sent_at: null, ...subOver });
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); const p = url.pathname;
  if (url.host === 'api.brevo.com') {
    const b = JSON.parse(await req.text()) as { to?: { email: string }[] };
    db.brevo.push({ to: b.to?.[0]?.email ?? '' });
    return db.brevoOk ? json(201, { messageId: 'm' }) : json(500, { message: 'brevo down' });
  }
  if (url.origin !== SUPABASE) { db.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, row == null ? [] : [row]));
  if (p.startsWith('/auth/v1/admin/users/')) { const u = db.users.get(p.split('/').pop()!); return u ? json(200, u) : json(404, { message: 'User not found' }); }
  if (p.endsWith('user_subscriptions')) {
    if (req.method === 'GET') {
      const now = Date.now();
      const rows = [...db.subs.values()].filter((s) => s.role !== 'pro' && s.trial_reminder_sent_at === null && Date.parse(s.trial_ends_at) > now && Date.parse(s.trial_ends_at) <= now + 3 * DAY);
      return json(200, rows.map((s) => ({ user_id: s.user_id, trial_ends_at: s.trial_ends_at })));
    }
    if (req.method === 'PATCH') {
      const uid = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, ''); const s = db.subs.get(uid);
      const body = JSON.parse(await req.text()) as Partial<Sub>;
      const onlyIfNull = url.searchParams.get('trial_reminder_sent_at') === 'is.null';
      if (!s || (onlyIfNull && s.trial_reminder_sent_at !== null)) return one(null);
      Object.assign(s, body);
      return one({ user_id: uid });
    }
  }
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const { GET } = await import('../app/api/trial-reminder/route.ts');
const run = () => GET(new Request('http://localhost/api/trial-reminder', { headers: { 'x-cron-secret': 'qa-cron-secret' } }));
beforeEach(reset);

test('E1. a CONFIRMED address is mailed once and the claim stays set', async () => {
  addUser(U1);
  const r = await run(); const b = await r.json() as { sent?: number };
  assert.equal(r.status, 200); assert.equal(b.sent, 1); assert.deepEqual(db.brevo.map((m) => m.to), [`${U1}@example.test`]);
  assert.notEqual(db.subs.get(U1)!.trial_reminder_sent_at, null, 'the claim was not kept after a successful send');
  await run(); assert.equal(db.brevo.length, 1, 'a second run mailed the same user again');
});
test('E2. an UNCONFIRMED address is NOT mailed and its claim stays free; once confirmed it is mailed', async () => {
  addUser(U2, { email_confirmed_at: null });
  await run();
  assert.equal(db.brevo.length, 0, 'a trial-ending email went to an address nobody confirmed (someone else\'s address typed at sign-up)');
  assert.equal(db.subs.get(U2)!.trial_reminder_sent_at, null, 'the claim was taken for a row that was skipped: it could never be mailed after confirming');
  db.users.get(U2)!.email_confirmed_at = new Date().toISOString();
  await run(); assert.deepEqual(db.brevo.map((m) => m.to), [`${U2}@example.test`]);
});
test('E3. a BANNED account is not mailed; a ban that has ended is', async () => {
  addUser(U3, { banned_until: new Date(Date.now() + 30 * DAY).toISOString() });
  await run(); assert.equal(db.brevo.length, 0, 'a banned account was mailed');
  db.users.get(U3)!.banned_until = new Date(Date.now() - DAY).toISOString();
  await run(); assert.equal(db.brevo.length, 1, 'an ENDED ban still blocks the email');
});
test('E4. Brevo FAILS -> the claim goes back to null (retried next run); a later success sends once and keeps the claim', async () => {
  addUser(U4); db.brevoOk = false;
  const r = await run(); const b = await r.json() as { sent?: number };
  assert.equal(b.sent, 0); assert.equal(db.brevo.length, 1, 'the send was not attempted');
  assert.equal(db.subs.get(U4)!.trial_reminder_sent_at, null, 'a failed send kept the claim: this user is never reminded');
  db.brevoOk = true; await run();
  assert.equal(db.brevo.length, 2); assert.notEqual(db.subs.get(U4)!.trial_reminder_sent_at, null);
  await run(); assert.equal(db.brevo.length, 2, 'it was sent again after a success');
});
test('E5. a claim another run already took is not sent twice', async () => {
  addUser(U5, {}, { trial_reminder_sent_at: new Date().toISOString() });
  await run(); assert.equal(db.brevo.length, 0);
});
test('W1. the welcome email releases its claim when the send fails (source anchor)', () => {
  const s = readFileSync(new URL('../app/api/auth/welcome-email/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(s.includes("if (!sent) await admin.from(T.user_subscriptions).update({ welcome_email_sent_at: null }).eq('user_id', user.id);"), 'a failed welcome send keeps its claim: this account is never welcomed');
});
