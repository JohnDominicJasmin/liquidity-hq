/* #1630 GO-LIVE 3 (#1643): a Whop payment refused for a SETTINGS reason is re-run automatically once the setting is fixed, and ONE PAYMENT CAN NEVER
 * GRANT TWICE by any path (webhook, sign-up claim, hourly retry).
 *
 * THE REAL CODE RUNS HERE: `POST` from app/api/whop/webhook/route.ts, `POST` from app/api/whop/claim/route.ts, and lib/whopGrant.ts's
 * retryRefusedWhopDeliveries / grantOnce with the real admin client. Only the network is a stand-in: an in-memory PostgREST + auth-admin (the same
 * method as whopClaim.test.mts), which can be told to fail a subscription write or the removal of an applied marker.
 *
 * WHAT THIS PINS: an unknown plan leaves exactly one retry row and grants nothing; a retry with the setting still wrong puts the row back with
 * attempts + 1; after the fix the next run grants ONCE (an applied marker, the retry row gone), a later run does nothing, and a re-delivery is still
 * counted once; past 7 days the row is dropped and reported; a fixed setting with no account hands off to a pending claim, which the sign-up claim
 * grants once; a failed write puts the row back unchanged and removes the marker so the next run grants; two overlapping runs grant once; no note
 * carries an email; grantOnce refuses a second application; a marker that cannot be removed after a failed grant is REPORTED for a person (#1643
 * review); a claim for a payment another path already applied is spent, not put back; the version flags say whether each checkout link's plan id is
 * the one the unlock grants for; the deliveries route is admin-only, read-only and email-free; the ingest carries the retry without failing.
 *
 * WHAT IT CANNOT PROVE: real PostgREST behaviour for delete-returning and conflicts (the stand-in imitates them), a real Whop delivery, the hourly
 * cron actually firing on a deployed host, or a process dying between taking a retry row and putting it back (a written-down limit: the row is lost).
 *
 * NO REAL CREDENTIALS AND NO REAL DATABASE: the Supabase URL is a `.invalid` host; any other request fails the test instead of leaving the machine. */
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
const EMAIL = 'buyer@example.test'; const UID = '44444444-4444-4444-8444-444444444444';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type User = { id: string; email: string; email_confirmed_at: string | null; aud: string };
const db = {
  events: new Map<string, Record<string, unknown>>(), subs: new Map<string, Record<string, unknown>>(), users: new Map<string, User>(), tokens: new Map<string, string>(),
  failSubsWrite: false, failDelete: new Set<string>(), subsWrites: 0, seq: 0,
  reset() { this.events.clear(); this.subs.clear(); this.users.clear(); this.tokens.clear(); this.failSubsWrite = false; this.failDelete.clear(); this.subsWrites = 0; this.seq = 0; },
  addUser(email = EMAIL, confirmed: string | null = '2026-01-01T00:00:00Z', id = UID, token = 'tok_buyer') { this.users.set(id, { id, email, email_confirmed_at: confirmed, aud: 'authenticated' }); this.tokens.set(token, id); },
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
  const out = (rows: Record<string, unknown>[], status = 200) => single ? (rows.length === 1 ? json(status, rows[0]) : rows.length === 0 ? json(status, null) : noRow()) : json(status, rows);
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
      if (q.get('body->>payer_email')) rows = rows.filter((r) => (r.body as Record<string, unknown>)?.payer_email === eq('body->>payer_email'));
      rows.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.payload_hash).localeCompare(String(b.payload_hash)));
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return out(rows.map((r) => ({ payload_hash: r.payload_hash, resource_id: r.resource_id, body: r.body, event: r.event, received_at: r.received_at })));
    }
    if (req.method === 'DELETE') {
      const key = eq('payload_hash');
      if (db.failDelete.has(key)) return json(500, { code: 'XX000', message: 'delete failed (stand-in)' });
      const had = db.events.get(key); db.events.delete(key);
      return wantsRep ? json(200, had ? [{ payload_hash: key }] : []) : new Response(null, { status: 204 });
    }
  }
  if (table === T('user_subscriptions')) {
    if (req.method === 'GET') { const r = db.subs.get(eq('user_id')); return out(r ? [r] : []); }
    if (req.method === 'POST') {
      if (db.failSubsWrite) return json(500, { code: 'XX000', message: 'boom' });
      db.subsWrites++;
      const row = JSON.parse(await req.text()); db.subs.set(row.user_id, { ...(db.subs.get(row.user_id) ?? {}), ...row }); return json(201, null);
    }
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const PLANS_SET = { WHOP_PLAN_ID_MONTHLY: PLAN.m, WHOP_PLAN_ID_ANNUAL: PLAN.a, WHOP_PLAN_ID_FORTNIGHTLY: PLAN.f };
const PLANS_UNSET = { WHOP_PLAN_ID_MONTHLY: undefined, WHOP_PLAN_ID_ANNUAL: undefined, WHOP_PLAN_ID_FORTNIGHTLY: undefined };
function env(over: Record<string, string | undefined> = {}) {
  const e: Record<string, string | undefined> = {
    WHOP_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon', SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service',
    ...PLANS_SET, WHOP_COMPANY_ID: undefined, WHOP_TEST_PLAN_ID: undefined, ...over,
  };
  for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return { ...process.env };
}
let n = 0;
async function load(over: Record<string, string | undefined> = {}) {
  const e = env(over);
  const wh = await import(`../app/api/whop/webhook/route.ts?x=${Date.now()}-${n++}`);
  const cl = await import(`../app/api/whop/claim/route.ts?x=${Date.now()}-${n++}`);
  const g = await import(`../lib/whopGrant.ts?x=${Date.now()}-${n++}`) as typeof import('../lib/whopGrant.ts');
  const { getSupabaseAdmin } = await import('../lib/supabase-admin.ts');
  const sb = getSupabaseAdmin();
  return { hook: wh.POST as (r: NextRequest) => Promise<Response>, claim: cl.POST as (r: NextRequest) => Promise<Response>, g, sb, env: e };
}
const sign = (body: string, id = `msg_${n++}`) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return new NextRequest('http://localhost/api/whop/webhook', { method: 'POST', body, headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,' + crypto.createHmac('sha256', SECRET).update(`${id}.${ts}.${body}`).digest('base64') } });
};
const pay = (data: Record<string, unknown> = {}, extra = '') => JSON.stringify({ id: 'msg_x', type: 'payment.succeeded', account_id: 'biz_ours', data: { id: 'pay_retry', status: 'paid', substatus: 'succeeded', usd_total: 49, currency: 'usd', user: { email: EMAIL, name: 'Buyer' }, plan: { id: PLAN.m }, company: { id: 'biz_ours' }, ...data }, ...(extra ? { qa_extra: extra } : {}) });
let ipN = 0;
const claimReq = (token = 'tok_buyer', ip = `10.1.0.${++ipN}`) => new NextRequest('http://localhost/api/whop/claim', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip } });
const fresh = () => { db.reset(); sentry().length = 0; };
const rows = (event: string) => [...db.events.values()].filter((e) => e.event === event);
const deliveries = () => [...db.events.values()].filter((e) => !String(e.event ?? '').startsWith('lhq.'));
const reviews = () => sentry().filter((a) => /NEEDS MANUAL REVIEW/.test(String((a[0] as Error)?.message)));
const days = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 86400_000;

test('W1. a paid delivery for a plan id the unlock does not know grants nothing and leaves exactly ONE retry row (reason, first refusal, 0 attempts)', async () => {
  const { hook, g } = await load(PLANS_UNSET); fresh(); db.addUser();
  const r = await hook(sign(pay())); assert.match(String((await r.json()).review), /^unknown_plan/);
  assert.equal(db.subs.size, 0);
  const retry = rows(g.WHOP_RETRY_EVENT); assert.equal(retry.length, 1);
  assert.equal(retry[0].payload_hash, g.retryHash('pay_retry'));
  const b = retry[0].body as Record<string, unknown>; assert.match(String(b.reason), /^unknown_plan/); assert.equal(b.attempts, 0); assert.ok(b.first_refused_at);
  assert.equal(rows(g.WHOP_APPLIED_EVENT).length, 0, 'an applied marker for a payment that was not applied');
  await hook(sign(pay({}, 'redelivered')));
  assert.equal(rows(g.WHOP_RETRY_EVENT).length, 1, 'a second refusal of the same payment made a second retry row');
});

test('R1. a retry while the setting is still wrong puts the row back with attempts + 1 and grants nothing', async () => {
  const { hook, g, sb } = await load(PLANS_UNSET); fresh(); db.addUser();
  await hook(sign(pay()));
  const s = await g.retryRefusedWhopDeliveries(sb, { ...process.env });
  assert.deepEqual([s.checked, s.stillRefused, s.granted, s.errors], [1, 1, 0, 0]);
  const retry = rows(g.WHOP_RETRY_EVENT); assert.equal(retry.length, 1); assert.equal((retry[0].body as Record<string, unknown>).attempts, 1);
  assert.equal(db.subs.size, 0);
});

test('R2. after the fix the next run grants ONCE (marker written, retry row gone); a third run does nothing; a re-delivery is still counted once', async () => {
  let L = await load(PLANS_UNSET); fresh(); db.addUser();
  await L.hook(sign(pay()));
  L = await load(PLANS_SET);
  const s = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env });
  assert.equal(s.granted, 1, JSON.stringify(s));
  assert.ok(s.notes.some((x) => /payment pay_retry: granted monthly/.test(x)));
  const sub = db.subs.get(UID)!; assert.equal(sub.role, 'pro'); assert.ok(days(sub.current_period_end) > 28 && days(sub.current_period_end) < 32);
  assert.equal(rows(L.g.WHOP_RETRY_EVENT).length, 0); assert.equal(rows(L.g.WHOP_APPLIED_EVENT).length, 1);
  const end = sub.current_period_end; const writes = db.subsWrites;
  const s3 = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env }); assert.equal(s3.checked, 0);
  const again = await (await L.hook(sign(pay({}, 'resent-after-grant')))).json();
  assert.ok(['payment_already_counted', 'payment_already_applied'].includes(String(again.ignored)), JSON.stringify(again));
  assert.equal(db.subs.get(UID)!.current_period_end, end); assert.equal(db.subsWrites, writes, 'a second subscription write');
});

test('R3. past 7 days from the first refusal the row is dropped and reported ("gave up"), even if the setting is fixed by then', async () => {
  let L = await load(PLANS_UNSET); fresh(); db.addUser();
  await L.hook(sign(pay()));
  const row = rows(L.g.WHOP_RETRY_EVENT)[0]; (row.body as Record<string, unknown>).first_refused_at = new Date(Date.now() - 8 * 86400_000).toISOString();
  L = await load(PLANS_SET);
  const s = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env });
  assert.deepEqual([s.gaveUp, s.granted], [1, 0]); assert.ok(s.notes.some((x) => /gave up after 7 days/.test(x)));
  assert.equal(rows(L.g.WHOP_RETRY_EVENT).length, 0); assert.equal(db.subs.size, 0);
});

test('R4. fixed setting but no account for the payer yet: handed off to a pending claim, which the sign-up claim grants once', async () => {
  let L = await load(PLANS_UNSET); fresh();
  await L.hook(sign(pay()));
  L = await load(PLANS_SET);
  const s = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env });
  assert.equal(s.handedOff, 1, JSON.stringify(s)); assert.ok(s.notes.some((x) => /no_account_for_payer_email/.test(x)));
  assert.equal(rows(L.g.WHOP_RETRY_EVENT).length, 0); assert.equal(rows(L.g.WHOP_PENDING_CLAIM_EVENT).length, 1);
  db.addUser();
  assert.deepEqual(await (await L.claim(claimReq())).json(), { granted: 1 });
  assert.deepEqual(await (await L.claim(claimReq())).json(), { granted: 0 });
  assert.equal(rows(L.g.WHOP_APPLIED_EVENT).length, 1);
});

test('R5. a subscription write that fails during a retry puts the row back UNCHANGED and removes the marker; the next run grants', async () => {
  let L = await load(PLANS_UNSET); fresh(); db.addUser();
  await L.hook(sign(pay()));
  L = await load(PLANS_SET);
  db.failSubsWrite = true;
  const s = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env });
  assert.equal(s.errors, 1, JSON.stringify(s));
  const retry = rows(L.g.WHOP_RETRY_EVENT); assert.equal(retry.length, 1); assert.equal((retry[0].body as Record<string, unknown>).attempts, 0, 'a failed write counted as an attempt');
  assert.equal(rows(L.g.WHOP_APPLIED_EVENT).length, 0, 'the marker stayed after a failed grant: every later attempt would say "already applied"');
  db.failSubsWrite = false;
  const s2 = await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env }); assert.equal(s2.granted, 1);
  assert.equal(db.subs.get(UID)!.role, 'pro');
});

test('R6. two overlapping retry runs grant the payment once', async () => {
  let L = await load(PLANS_UNSET); fresh(); db.addUser();
  await L.hook(sign(pay()));
  L = await load(PLANS_SET);
  const [a, b] = await Promise.all([L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env }), L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env })]);
  assert.equal(a.granted + b.granted, 1, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
  assert.equal(db.subsWrites, 1);
});

test('R7. no retry note carries an email address (they go to the error report)', async () => {
  let L = await load(PLANS_UNSET); fresh();
  await L.hook(sign(pay()));
  const row = rows(L.g.WHOP_RETRY_EVENT)[0]; const kept = { ...(row.body as Record<string, unknown>) };
  L = await load(PLANS_SET);
  const notes = [...(await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env })).notes];
  db.events.set(row.payload_hash as string, { ...row, body: { ...kept, first_refused_at: new Date(Date.now() - 9 * 86400_000).toISOString() } });
  notes.push(...(await L.g.retryRefusedWhopDeliveries(L.sb, { ...process.env })).notes);
  assert.ok(notes.length >= 1);
  for (const x of notes) assert.ok(!/@/.test(x), `a note carries an address: ${x}`);
});

test('M1. grantOnce: the marker is written before the grant; a second application of the same payment is "already applied" and writes nothing', async () => {
  const L = await load(PLANS_SET); fresh(); db.addUser();
  const d = { plan: 'monthly', add: { months: 1 } };
  const first = await L.g.grantOnce(L.sb, 'pay_once', UID, d); assert.equal(first.kind, 'granted');
  assert.equal(rows(L.g.WHOP_APPLIED_EVENT).length, 1); assert.equal(rows(L.g.WHOP_APPLIED_EVENT)[0].payload_hash, L.g.appliedHash('pay_once'));
  const second = await L.g.grantOnce(L.sb, 'pay_once', UID, d); assert.equal(second.kind, 'already_applied');
  assert.equal(db.subsWrites, 1);
});

test('M2. a failed grant whose marker cannot be removed is REPORTED for a person with the payment id (the #1643 review fix)', async () => {
  const L = await load(PLANS_SET); fresh(); db.addUser();
  db.failSubsWrite = true; db.failDelete.add(L.g.appliedHash('pay_stuck'));
  const r = await L.g.grantOnce(L.sb, 'pay_stuck', UID, { plan: 'monthly', add: { months: 1 } });
  assert.equal(r.kind, 'error');
  const rep = reviews().map((a) => String((a[0] as Error).message));
  assert.ok(rep.some((m) => /pay_stuck/.test(m) && /applied marker could not be removed/.test(m)), `not reported: ${JSON.stringify(rep)}`);
});

test('C1. a claim for a payment another path already applied is SPENT (not put back) and grants nothing', async () => {
  const L = await load(PLANS_SET); fresh();
  await L.hook(sign(pay()));                          // no account yet: a pending claim
  assert.equal(rows(L.g.WHOP_PENDING_CLAIM_EVENT).length, 1);
  db.addUser();
  await L.g.grantOnce(L.sb, 'pay_retry', UID, { plan: 'monthly', add: { months: 1 } }); // another path applied it first
  const writes = db.subsWrites;
  assert.deepEqual(await (await L.claim(claimReq())).json(), { granted: 0 });
  assert.equal(rows(L.g.WHOP_PENDING_CLAIM_EVENT).length, 0, 'the spent claim was put back');
  assert.equal(db.subsWrites, writes);
});

test('F1. /api/version flags: a checkout link\'s plan id must be the one the unlock grants for, for that same plan', async () => {
  const { configuredFlags } = await import('../lib/configured.ts');
  // Real Whop plan ids are `plan_` + letters and digits (e.g. plan_Lt14d8fRCCBIa); the link parser reads exactly that shape.
  const ID = { m: 'plan_QaMonthly1', a: 'plan_QaAnnual2', f: 'plan_QaFortnight3' };
  const TABLE = { WHOP_PLAN_ID_MONTHLY: ID.m, WHOP_PLAN_ID_ANNUAL: ID.a, WHOP_PLAN_ID_FORTNIGHTLY: ID.f };
  const link = (id: string) => `https://whop.com/checkout/${id}`;
  const f = (e: Record<string, string | undefined>) => configuredFlags(e);
  assert.equal(f({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: link(ID.m), ...TABLE }).whopPlanMatchesLinkMonthly, true, 'equal');
  assert.equal(f({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: link('plan_Other1'), ...TABLE }).whopPlanMatchesLinkMonthly, false, 'different id');
  assert.equal(f({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: link(ID.a), ...TABLE }).whopPlanMatchesLinkMonthly, false, 'the annual id behind the monthly link');
  assert.equal(f({ ...TABLE }).whopPlanMatchesLinkMonthly, false, 'no link');
  assert.equal(f({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: link(ID.m) }).whopPlanMatchesLinkMonthly, false, 'no plan table');
  const flags = f({ NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL: link(ID.a), ...TABLE });
  for (const k of ['whopPlanMatchesLinkMonthly', 'whopPlanMatchesLinkAnnual', 'whopPlanMatchesLinkFortnightly'] as const) assert.equal(typeof flags[k], 'boolean');
  assert.equal(flags.whopPlanMatchesLinkAnnual, true);
});

test('S1. the deliveries view is admin-only, writes nothing, and shows whether a payer email exists, never the address', () => {
  const src = stripTsComments(read('app/api/ops/whop/deliveries/route.ts'));
  assert.ok(/export const GET = withAdmin\(/.test(src), 'not wrapped in withAdmin');
  assert.ok(!/export const (POST|PUT|PATCH|DELETE)\b/.test(src), 'a write method exists');
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(src), 'the view writes to the database');
  assert.ok(/hasPayerEmail: !!p\?\.payerEmail,/.test(src));
  assert.ok(!/payerEmail:\s/.test(src.replace(/hasPayerEmail: !!p\?\.payerEmail,/, '')), 'the payer email is in the response shape');
  assert.ok(/decisionNow: d\.kind === 'grant' \? \{ kind: 'grant', plan: d\.plan \} : \{ kind: d\.kind, reason: d\.reason \},/.test(src), 'the dry-run decision is not reduced to kind/plan/reason');
});

test('S2. the hourly ingest carries the retry first, never lets it fail the ingest, and answers counts only (the notes go to the error report)', () => {
  const src = stripTsComments(read('app/api/econ-calendar/ingest/route.ts'));
  assert.ok(/async function whopRetryTick\(\)[\s\S]{0,400}try \{[\s\S]{0,300}retryRefusedWhopDeliveries\(getSupabaseAdmin\(\), process\.env\)[\s\S]{0,300}\} catch \(e\) \{\s*return \{ error:/.test(src), 'the retry is not wrapped so it cannot fail the ingest');
  assert.ok(src.indexOf('const whopRetry = await whopRetryTick();') > src.indexOf('if (!checkCronAuth(req))'), 'the retry runs before the cron secret is checked');
  assert.ok(/const \{ notes: _notes, \.\.\.counts \} = r;/.test(src), 'the notes are not stripped from the cron response');
});
