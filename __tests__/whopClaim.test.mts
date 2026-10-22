/* #1567 (#1607): a buyer who paid on Whop BEFORE they had a confirmed LiquidityHQ account gets Pro automatically when that email signs up or signs in.
 *
 * THE REAL ROUTES RUN HERE: `POST` from app/api/whop/webhook/route.ts (which leaves a PENDING CLAIM row when a paid payment has no account to go to) and `POST` from
 * app/api/whop/claim/route.ts (which grants the pending payments for the CALLER'S confirmed email), with Standard-Webhooks-signed requests and a bearer token. Only the
 * network is a stand-in: an in-memory PostgREST and auth-admin that knows the events table (including `delete().select()` and the `body->>payer_email` filter), the subscriptions
 * table, the lookup function and users. Same method as whopWebhookGrant.test.mts.
 *
 * THE PROPERTIES THAT MATTER MOST, each mutation-checked (the line was broken, the named case went red):
 *   - one payment is granted once however many callers race for it (R3);
 *   - a claim that could not be applied is PUT BACK, under its OWN address, never the caller's (R4, C1);
 *   - only the account whose CONFIRMED email equals the payer's can claim (R5, R6, C1);
 *   - the rules are re-applied at claim time, so a payment that no longer qualifies grants nothing (R7);
 *   - the route tells the caller only how many it applied (C2).
 *
 * WHAT THIS CANNOT PROVE (the verdict says so): that real PostgREST treats `delete().select()` and the `body->>payer_email` filter the way this stand-in does, that the browser calls the
 * claim route on a real sign-in and Pro shows without a reload, a real Whop delivery shape (the fixture body is from Whop's documentation), and a crash between the delete that takes a claim
 * and the grant that uses it (a known, written-down limit: the claim is lost).
 *
 * NO REAL CREDENTIALS AND NO REAL DATABASE. The Supabase URL is a `.invalid` host; a request to any other host fails the test instead of leaving the machine. */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));
const sentry = () => ((globalThis as unknown as { __qaSentry?: unknown[][] }).__qaSentry ??= []);

const SUPABASE = 'http://supabase.invalid';
const SECRET = 'ws_qa_fixture_secret_not_real';
const PLAN = { m: 'plan_QA_MONTHLY', a: 'plan_QA_ANNUAL', f: 'plan_QA_FORTNIGHTLY' };
const EMAIL = 'late@example.test'; const UID = '22222222-2222-4222-8222-222222222222';
const OTHER = 'other@example.test'; const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type User = { id: string; email: string; email_confirmed_at: string | null; aud: string };
const db = {
  events: new Map<string, Record<string, unknown>>(), subs: new Map<string, Record<string, unknown>>(), users: new Map<string, User>(), tokens: new Map<string, string>(),
  failSubsWrite: false, relaxEmailFilter: false, seq: 0,
  reset() { this.events.clear(); this.subs.clear(); this.users.clear(); this.tokens.clear(); this.failSubsWrite = false; this.relaxEmailFilter = false; this.seq = 0; },
  addUser(email = EMAIL, confirmed: string | null = '2026-01-01T00:00:00Z', id = UID, token = 'tok_late') { this.users.set(id, { id, email, email_confirmed_at: confirmed, aud: 'authenticated' }); this.tokens.set(token, id); },
};
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); if (url.origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  const p = url.pathname; const q = url.searchParams;
  const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object'); const wantsRep = (req.headers.get('prefer') ?? '').includes('return=representation');
  const eq = (k: string) => (q.get(k) ?? '').replace(/^eq\./, '');
  const noRow = () => json(406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });
  const out = (rows: Record<string, unknown>[], status = 200) => single ? (rows.length === 1 ? json(status, rows[0]) : noRow()) : json(status, rows);

  if (p === '/auth/v1/user') { const id = db.tokens.get((req.headers.get('authorization') ?? '').replace('Bearer ', '')); const u = id ? db.users.get(id) : null; return u ? json(200, u) : json(401, { message: 'bad jwt' }); }
  const adm = p.match(/^\/auth\/v1\/admin\/users\/(.+)$/); if (adm) { const u = db.users.get(adm[1]); return u ? json(200, u) : json(404, { message: 'User not found' }); }
  const rpc = p.match(/^\/rest\/v1\/rpc\/(.+)$/);
  if (rpc) { const { p_email } = JSON.parse(await req.text()); const hit = [...db.users.values()].find((u) => u.email === p_email); return json(200, hit ? hit.id : null); }
  const table = p.replace('/rest/v1/', '');
  if (table === T('whop_webhook_events')) {
    if (req.method === 'POST') {
      const row = JSON.parse(await req.text());
      if (db.events.has(row.payload_hash)) return json(409, { code: '23505', message: 'duplicate key' });
      db.events.set(row.payload_hash, { ...row, received_at: new Date(Date.now() + db.seq++).toISOString() });
      return wantsRep ? out([{ payload_hash: row.payload_hash }], 201) : json(201, null);
    }
    if (req.method === 'GET') {
      let rows = [...db.events.values()];
      for (const k of ['event', 'resource_id', 'payload_hash']) if (q.get(k)) rows = rows.filter((r) => r[k] === eq(k));
      if (q.get('body->>payer_email') && !db.relaxEmailFilter) rows = rows.filter((r) => (r.body as Record<string, unknown>)?.payer_email === eq('body->>payer_email'));
      rows.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.payload_hash).localeCompare(String(b.payload_hash)));
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return out(rows.map((r) => ({ payload_hash: r.payload_hash, resource_id: r.resource_id, body: r.body })));
    }
    if (req.method === 'DELETE') {
      const key = eq('payload_hash'); const had = db.events.get(key); db.events.delete(key);
      return wantsRep ? json(200, had ? [{ payload_hash: key }] : []) : new Response(null, { status: 204 }); // a 204 has no body; json(204, null) threw, so every plain delete read as failed
    }
  }
  if (table === T('user_subscriptions')) {
    if (req.method === 'GET') { const r = db.subs.get(eq('user_id')); return out(r ? [r] : []); }
    if (req.method === 'POST') {
      if (db.failSubsWrite) return json(500, { code: 'XX000', message: 'boom' });
      const row = JSON.parse(await req.text()); db.subs.set(row.user_id, { ...(db.subs.get(row.user_id) ?? {}), ...row }); return json(201, null);
    }
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

function env(over: Record<string, string | undefined> = {}) {
  const e: Record<string, string | undefined> = {
    WHOP_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon', SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service',
    WHOP_PLAN_ID_MONTHLY: PLAN.m, WHOP_PLAN_ID_ANNUAL: PLAN.a, WHOP_PLAN_ID_FORTNIGHTLY: PLAN.f, WHOP_COMPANY_ID: undefined, WHOP_TEST_PLAN_ID: undefined, ...over,
  };
  for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
let n = 0;
/* The routes read some settings once at load, so each environment gets its own import of both. */
async function load(over: Record<string, string | undefined> = {}) {
  env(over);
  const wh = await import(`../app/api/whop/webhook/route.ts?x=${Date.now()}-${n++}`);
  const cl = await import(`../app/api/whop/claim/route.ts?x=${Date.now()}-${n++}`);
  return { hook: wh.POST as (r: NextRequest) => Promise<Response>, claim: cl.POST as (r: NextRequest) => Promise<Response> };
}
const sign = (body: string, id = `msg_${n++}`) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return new NextRequest('http://localhost/api/whop/webhook', { method: 'POST', body, headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,' + crypto.createHmac('sha256', SECRET).update(`${id}.${ts}.${body}`).digest('base64') } });
};
const pay = (data: Record<string, unknown> = {}) => JSON.stringify({ id: 'msg_x', type: 'payment.succeeded', account_id: 'biz_ours', data: { id: 'pay_late', status: 'paid', substatus: 'succeeded', usd_total: 49, currency: 'usd', user: { email: EMAIL, name: 'Late Buyer' }, plan: { id: PLAN.m }, company: { id: 'biz_ours' }, ...data } });
let ipN = 0;
const claimReq = (token = 'tok_late', ip = `10.0.0.${++ipN}`) => new NextRequest('http://localhost/api/whop/claim', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip } });
const fresh = () => { db.reset(); sentry().length = 0; };
const pendings = () => [...db.events.values()].filter((e) => e.event === 'lhq.pending_claim');
const reviews = () => sentry().filter((a) => /NEEDS MANUAL REVIEW/.test(String((a[0] as Error)?.message)));
const days = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 86400_000;

test('R1. a payment BEFORE any account: review and ONE pending claim; after sign-up the claim grants ONCE and closes; claiming again grants nothing', async () => {
  const { hook, claim } = await load(); fresh();
  const r = await hook(sign(pay())); assert.equal((await r.json()).review, 'no_account_for_payer_email');
  assert.equal(pendings().length, 1); assert.equal(db.subs.size, 0);
  db.addUser();
  const c = await claim(claimReq()); assert.deepEqual(await c.json(), { granted: 1 });
  const row = db.subs.get(UID)!; assert.equal(row.role, 'pro'); assert.equal(row.billing_provider, 'whop'); assert.equal(row.plan, 'monthly');
  assert.ok(days(row.current_period_end) > 28 && days(row.current_period_end) < 32);
  assert.equal(pendings().length, 0);
  const end = row.current_period_end;
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 0 }); assert.equal(db.subs.get(UID)!.current_period_end, end, 'a second claim extended again');
});

test('R2. the same payment delivered again with different bytes AFTER the claim is still counted once; the same bytes are a replay', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); db.addUser(); await claim(claimReq());
  const end = db.subs.get(UID)!.current_period_end;
  assert.equal((await (await hook(sign(pay({ extra: 1 })))).json()).ignored, 'payment_already_counted');
  assert.equal((await (await hook(sign(pay()))).json()).ignored, 'replay');
  assert.equal(db.subs.get(UID)!.current_period_end, end); assert.equal(pendings().length, 0);
});

test('R3. two claims racing for one payment: exactly one grants, one month only', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); db.addUser();
  const [a, b] = await Promise.all([claim(claimReq('tok_late', '2.2.2.2')), claim(claimReq('tok_late', '3.3.3.3'))]);
  assert.equal((await a.json()).granted + (await b.json()).granted, 1);
  assert.ok(days(db.subs.get(UID)!.current_period_end) > 27 && days(db.subs.get(UID)!.current_period_end) < 33, 'one month only');
});

test('R4. the grant fails: the claim is PUT BACK (not lost), nothing is granted, and the next claim grants', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); db.addUser(); db.failSubsWrite = true;
  const c = await claim(claimReq()); assert.equal(c.status, 500); assert.equal(pendings().length, 1, 'the claim was lost on a failed grant'); assert.equal(db.subs.size, 0);
  assert.equal((pendings()[0].body as Record<string, unknown>).payer_email, EMAIL);
  db.failSubsWrite = false; assert.deepEqual(await (await claim(claimReq())).json(), { granted: 1 }); assert.equal(pendings().length, 0);
});

test('R5. an unconfirmed address claims nothing; a different account claims nothing; no token and a bad token are 401', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay()));
  db.addUser(EMAIL, null); assert.deepEqual(await (await claim(claimReq())).json(), { granted: 0 }); assert.equal(pendings().length, 1);
  db.addUser(OTHER, '2026-01-01T00:00:00Z', OTHER_ID, 'tok_other');
  assert.deepEqual(await (await claim(claimReq('tok_other'))).json(), { granted: 0 }); assert.equal(db.subs.size, 0); assert.equal(pendings().length, 1);
  assert.equal((await claim(new NextRequest('http://localhost/api/whop/claim', { method: 'POST' }))).status, 401);
  assert.equal((await claim(claimReq('nope'))).status, 401);
  assert.equal(db.subs.size, 0);
});

test('R6. an account that exists but is unconfirmed when the payment arrives: a pending claim; once confirmed, the claim grants', async () => {
  const { hook, claim } = await load(); fresh(); db.addUser(EMAIL, null);
  const r = await hook(sign(pay())); assert.equal((await r.json()).review, 'account_email_not_confirmed'); assert.equal(pendings().length, 1);
  db.users.get(UID)!.email_confirmed_at = '2026-02-02T00:00:00Z';
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 1 });
});

test('R7. the rules are re-applied at claim time: a plan that left the table, a company mismatch, then the right settings: nothing granted and the claim kept, then granted', async () => {
  let t = await load(); fresh(); await t.hook(sign(pay())); db.addUser();
  t = await load({ WHOP_PLAN_ID_MONTHLY: undefined });
  assert.deepEqual(await (await t.claim(claimReq())).json(), { granted: 0 }); assert.equal(db.subs.size, 0); assert.equal(pendings().length, 1); assert.ok(reviews().length >= 1);
  t = await load({ WHOP_COMPANY_ID: 'biz_other' });
  assert.deepEqual(await (await t.claim(claimReq())).json(), { granted: 0 }); assert.equal(pendings().length, 1);
  t = await load();
  assert.deepEqual(await (await t.claim(claimReq())).json(), { granted: 1 });
});

test('R8. a $0, unknown-plan, hidden-test-plan, unpaid or negative payment leaves NO pending claim (nothing to recover)', async () => {
  const { hook } = await load();
  for (const over of [{ usd_total: 0 }, { usd_total: -49 }, { plan: { id: 'plan_UNKNOWN' } }, { plan: { id: 'plan_Lt14d8fRCCBIa' } }, { status: 'open' }]) { fresh(); await hook(sign(pay(over))); assert.equal(pendings().length, 0, JSON.stringify(over)); }
});

test('R9. two payments before sign-up: both pending, both granted, the periods ADD UP', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay({ id: 'pay_1' }))); await hook(sign(pay({ id: 'pay_2' }))); assert.equal(pendings().length, 2); db.addUser();
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 2 });
  assert.ok(days(db.subs.get(UID)!.current_period_end) > 57 && days(db.subs.get(UID)!.current_period_end) < 64, 'two months expected');
});

test('R10. an admin-granted account: the claim is refused and kept, and the account is untouched', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); db.addUser(); db.subs.set(UID, { user_id: UID, role: 'pro', current_period_end: null, billing_provider: null });
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 0 }); assert.equal(pendings().length, 1); assert.equal(db.subs.get(UID)!.current_period_end, null);
});

test('C1. if the email filter on the lookup ever misbehaves, someone else\'s claim is refused and put back under ITS OWN address, and the real payer can still claim it', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); // a pending claim for late@example.test
  db.addUser(OTHER, '2026-01-01T00:00:00Z', OTHER_ID, 'tok_other');
  db.relaxEmailFilter = true; // the lookup now returns every pending claim, whoever it belongs to
  const r = await claim(claimReq('tok_other'));
  assert.deepEqual(await r.json(), { granted: 0 }); assert.equal(db.subs.size, 0, 'a stranger received someone else\'s payment');
  assert.equal(pendings().length, 1, 'the claim must still exist');
  assert.equal((pendings()[0].body as Record<string, unknown>).payer_email, EMAIL, 'the claim was re-keyed to the caller\'s address');
  db.relaxEmailFilter = false; db.addUser();
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 1 }); assert.equal(db.subs.get(UID)!.role, 'pro'); assert.equal(db.subs.has(OTHER_ID), false);
});

test('C2. the claim route says only how many it applied: the same answer for nothing to claim, an unconfirmed address and a wrong account; no address, name or payment detail in any answer', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay()));
  db.addUser(EMAIL, null); db.addUser(OTHER, '2026-01-01T00:00:00Z', OTHER_ID, 'tok_other');
  const answers = [await (await claim(claimReq('tok_late'))).text(), await (await claim(claimReq('tok_other'))).text()];
  db.users.get(UID)!.email_confirmed_at = '2026-01-01T00:00:00Z'; answers.push(await (await claim(claimReq('tok_late'))).text());
  assert.deepEqual(answers, ['{"granted":0}', '{"granted":0}', '{"granted":1}']);
  const reports = sentry().map((a) => String((a[0] as Error)?.message)).join('\n');
  for (const text of [...answers, reports, await (await claim(new NextRequest('http://localhost/api/whop/claim', { method: 'POST' }))).text()]) {
    assert.ok(!/@/.test(text), 'an address leaked: ' + text.slice(0, 100)); assert.ok(!/Late Buyer/.test(text)); assert.ok(!text.includes(SECRET));
  }
});

test('C3. the pending claim row holds only the delivery hash, the payer address and the reason (no name, no amount), and one row per payment however often the payment arrives', async () => {
  const { hook } = await load(); fresh();
  await hook(sign(pay())); await hook(sign(pay({ extra: 1 }))); await hook(sign(pay({ extra: 2 })));
  assert.equal(pendings().length, 1);
  assert.deepEqual(Object.keys(pendings()[0].body as object).sort(), ['delivery_hash', 'payer_email', 'reason']);
  assert.equal((pendings()[0].body as Record<string, unknown>).payer_email, EMAIL);
});

test('C4. the claim route is rate limited per account and address: the 11th call in a minute is 429 and touches nothing', async () => {
  const { hook, claim } = await load(); fresh();
  await hook(sign(pay())); db.addUser(EMAIL, null); // unconfirmed: every call is a cheap "nothing"
  const ip = '77.7.7.7';
  for (let i = 0; i < 10; i++) assert.equal((await claim(claimReq('tok_late', ip))).status, 200, `call ${i + 1}`);
  const r = await claim(claimReq('tok_late', ip)); assert.equal(r.status, 429); assert.deepEqual(await r.json(), { granted: 0 });
  assert.equal(pendings().length, 1);
});

test('C5. more claims than one lookup returns (10): the first sign-in grants ten, the next grants the rest, and every period adds up', async () => {
  const { hook, claim } = await load(); fresh();
  for (let i = 0; i < 11; i++) await hook(sign(pay({ id: `pay_${i}` })));
  assert.equal(pendings().length, 11); db.addUser();
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 10 });
  assert.deepEqual(await (await claim(claimReq())).json(), { granted: 1 });
  assert.equal(pendings().length, 0);
  assert.ok(days(db.subs.get(UID)!.current_period_end) > 11 * 29, 'eleven months expected');
});

test('S1. source: the claim route takes the address from the verified token\'s user and never from the request body; only POST is exported', () => {
  const src = stripTsComments(read('app/api/whop/claim/route.ts'));
  assert.ok(!/req\.(json|formData|text)\(/.test(src), 'the claim route reads the request body');
  // #1397 follow-up: the route now asks Auth through fetchAuthUser (lib/authUser.ts), only when a claim is waiting for the token's address.
  assert.ok(/user\.email/.test(src) && /fetchAuthUser\(token\)/.test(src));
  assert.deepEqual([...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]).filter((x) => x !== 'dynamic'), ['POST']);
});
