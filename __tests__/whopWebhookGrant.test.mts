/* #1567 Phase 3: the Whop webhook turns a verified, PAID payment for one of our plans into Pro, and never takes Pro away (#1599).
 *
 * THE REAL ROUTE RUNS HERE. `POST` is imported from app/api/whop/webhook/route.ts and called with real NextRequests signed the Standard
 * Webhooks way by a secret generated in this file. Only the network is a stand-in: `globalThis.fetch` is replaced by an in-memory PostgREST
 * and auth-admin that knows the events table, the subscriptions table, the lookup function and users. So the real verifier, the real rules,
 * the real supabase-js client and the real ordering of reads and writes all run, and every request the route makes is seen.
 *
 * WHAT THIS PROVES: the route's decisions and the order of its reads and writes, for the field paths the code assumes.
 * WHAT IT CANNOT PROVE (the verdict says so): that those field paths match what Whop really sends. The fixture body is built from Whop's
 * DOCUMENTATION, not from a recorded delivery (none existed when the code was written). The first real body is the check on that, and when
 * it is recorded this fixture must be replaced by it. Also not covered here: the table prefix (lhq_ vs lhq_dev_ is fixed when lib/tables.ts
 * first loads, so one process sees one prefix), a real database, and whether Whop sends the buyer's email at all (it needs a webhook
 * permission).
 *
 * THE PROPERTIES THAT MATTER MOST, each mutation-checked (the line was broken, the named case went red):
 *   - one payment is counted once, however many bodies it arrives in (G5, G5b);
 *   - a grant that fails to WRITE leaves the delivery retryable (N7, N7b): the record is the replay guard, so it must be removed;
 *   - nothing ever writes a role other than 'pro' (V1, V4);
 *   - the hidden $1 test plan and any unknown plan never grant (N2, N2b).
 *
 * NO REAL CREDENTIALS AND NO REAL DATABASE. The Supabase URL is a `.invalid` host and the key a placeholder; a request to any other host
 * fails the test instead of leaving the machine. The addresses are reserved test domains. */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { configuredFlags } from '../lib/configured.ts';
import { extendedPeriodEnd, whopPlanTable } from '../lib/whopEntitlement.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Sentry, stood in for: under plain Node its package entry has no captureException (it is built for Next's bundler), so lib/apiError.ts
 * would throw where it reports in the app. The stand-in records the calls, which is also how the tests see a "needs manual review" report. */
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
const TEST_PLAN = 'plan_Lt14d8fRCCBIa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'buyer@example.test';

/* ── the stand-in database ─────────────────────────────────────────────── */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Fail = null | 'rpc' | 'auth' | 'subsRead' | 'earliest' | 'subsWrite';
const db = {
  events: new Map<string, Record<string, unknown>>(), subs: new Map<string, Record<string, unknown>>(),
  users: new Map<string, { id: string; email: string; email_confirmed_at: string | null }>(),
  writes: [] as string[], tables: new Set<string>(), fail: null as Fail, seq: 0,
  reset() {
    this.events.clear(); this.subs.clear(); this.users.clear(); this.writes = []; this.tables.clear(); this.fail = null; this.seq = 0;
    this.users.set(USER_ID, { id: USER_ID, email: USER_EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z' });
  },
};
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  const p = url.pathname;
  const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
  const q = url.searchParams;
  const eq = (k: string) => (q.get(k) ?? '').replace(/^eq\./, '');
  const out = (rows: Record<string, unknown>[], status = 200) => single ? (rows.length === 1 ? json(status, rows[0]) : json(406, { code: 'PGRST116', message: 'no/many rows' })) : json(status, rows);

  const adm = p.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (adm) {
    if (db.fail === 'auth') return json(500, { message: 'auth boom' });
    const u = db.users.get(adm[1]); return u ? json(200, u) : json(404, { message: 'User not found' });
  }

  const rpc = p.match(/^\/rest\/v1\/rpc\/(.+)$/);
  if (rpc) {
    assert.equal(rpc[1], process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_user_id_by_email' : 'lhq_user_id_by_email');
    if (db.fail === 'rpc') return json(500, { code: 'XX000', message: 'rpc boom' });
    const { p_email } = JSON.parse(await req.text());
    const hit = [...db.users.values()].find((u) => u.email === p_email);
    return json(200, hit ? hit.id : null);
  }

  const table = p.replace('/rest/v1/', '');
  db.tables.add(table);
  if (table === T('whop_webhook_events')) {
    if (req.method === 'POST') {
      const row = JSON.parse(await req.text());
      if (db.events.has(row.payload_hash)) return json(409, { code: '23505', message: 'duplicate key' });
      db.events.set(row.payload_hash, { ...row, received_at: new Date(Date.now() + db.seq++).toISOString() });
      db.writes.push('events:insert');
      return out([{ payload_hash: row.payload_hash }], 201);
    }
    if (req.method === 'GET') {
      if (db.fail === 'earliest') return json(500, { code: 'XX000', message: 'earliest boom' });
      let rows = [...db.events.values()];
      if (q.get('event')) rows = rows.filter((r) => r.event === eq('event'));
      if (q.get('resource_id')) rows = rows.filter((r) => r.resource_id === eq('resource_id'));
      rows.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.payload_hash).localeCompare(String(b.payload_hash)));
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return out(rows.map((r) => ({ payload_hash: r.payload_hash })));
    }
    if (req.method === 'DELETE') { db.events.delete(eq('payload_hash')); db.writes.push('events:delete'); return new Response(null, { status: 204 }); } // a 204 has no body; json(204, null) threw, so every delete read as failed
  }
  if (table === T('user_subscriptions')) {
    if (req.method === 'GET') {
      if (db.fail === 'subsRead') return json(500, { code: 'XX000', message: 'subs read boom' });
      const r = db.subs.get(eq('user_id')); return out(r ? [r] : []);
    }
    if (req.method === 'POST') {
      if (db.fail === 'subsWrite') return json(500, { code: 'XX000', message: 'boom' });
      const row = JSON.parse(await req.text()); db.subs.set(row.user_id, { ...(db.subs.get(row.user_id) ?? {}), ...row });
      db.writes.push(`subs:upsert:${JSON.stringify(Object.keys(row).sort())}`);
      return json(201, null);
    }
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/* ── helpers ───────────────────────────────────────────────────────────── */

function env(over: Record<string, string | undefined> = {}) {
  const e: Record<string, string | undefined> = {
    WHOP_WEBHOOK_SECRET: SECRET, NEXT_PUBLIC_SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
    WHOP_PLAN_ID_MONTHLY: PLAN.m, WHOP_PLAN_ID_ANNUAL: PLAN.a, WHOP_PLAN_ID_FORTNIGHTLY: PLAN.f, WHOP_COMPANY_ID: undefined, WHOP_TEST_PLAN_ID: undefined, ...over,
  };
  for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
let n = 0;
/* The route reads WHOP_WEBHOOK_SECRET once, when it first loads, so each environment gets its own import of the route. */
async function load(over: Record<string, string | undefined> = {}) {
  env(over);
  const mod = await import(`../app/api/whop/webhook/route.ts?x=${Date.now()}-${n++}`);
  return mod.POST as (r: NextRequest) => Promise<Response>;
}
function req(body: string, o: { id?: string; ts?: number; sig?: string | null } = {}) {
  const id = o.id ?? `msg_${n++}`; const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const sig = o.sig === undefined ? 'v1,' + crypto.createHmac('sha256', SECRET).update(`${id}.${ts}.${body}`).digest('base64') : o.sig;
  const headers: Record<string, string> = { 'webhook-id': id, 'webhook-timestamp': ts };
  if (sig !== null) headers['webhook-signature'] = sig;
  return new NextRequest('http://localhost/api/whop/webhook', { method: 'POST', body, headers });
}
/* A payment.succeeded body as Whop's DOCUMENTATION describes it (not a recorded delivery). `dataOver` replaces fields of `data`. */
const pay = (over: Record<string, unknown> = {}, dataOver: Record<string, unknown> = {}) => JSON.stringify({
  id: 'msg_x', type: 'payment.succeeded', api_version: 'v1', timestamp: '2026-10-20T00:00:00Z', account_id: 'biz_ours',
  data: { id: 'pay_1', status: 'paid', substatus: 'succeeded', total: 49, usd_total: 49, currency: 'usd', user: { id: 'user_w', email: USER_EMAIL }, plan: { id: PLAN.m }, company: { id: 'biz_ours' }, ...dataOver },
  ...over,
});
const reviews = () => sentry().filter((a) => /NEEDS MANUAL REVIEW/.test(String((a[0] as Error)?.message)));
/* Changed with #1630 GO-LIVE 3 (Dev, intentionally): the events table now also holds two kinds of small bookkeeping rows, 'lhq.applied' (written
   before every grant) and 'lhq.retry' (left for a settings refusal), next to the existing 'lhq.pending_claim'. "One record" in N2b and N6 means
   one DELIVERY record, so they count deliveries only. */
const deliveries = () => [...db.events.values()].filter((r) => !String(r.event ?? '').startsWith('lhq.')).length;
const fresh = () => { db.reset(); sentry().length = 0; };
const body = async (r: Response) => r.json();
const addDays = (d: number) => Date.now() + d * 86400_000;
const daysFromNow = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 86400_000;

/* ── grants ────────────────────────────────────────────────────────────── */

test('G1-G3. each plan grants Pro with its own length; only role, period end, provider, plan and bookkeeping are written, to the buyer\'s row only', async () => {
  const POST = await load();
  for (const [plan, id, days] of [['fortnightly', PLAN.f, 14], ['monthly', PLAN.m, 30], ['annual', PLAN.a, 365]] as const) {
    fresh();
    const r = await POST(req(pay({}, { plan: { id } })));
    const b = await body(r);
    assert.equal(r.status, 200); assert.equal(b.granted, plan, JSON.stringify(b));
    const row = db.subs.get(USER_ID)!;
    assert.equal(row.role, 'pro'); assert.equal(row.billing_provider, 'whop'); assert.equal(row.plan, plan);
    assert.ok(Math.abs(daysFromNow(row.current_period_end) - days) < 3, `${plan}: ${daysFromNow(row.current_period_end)} days`);
    assert.deepEqual([...db.subs.keys()], [USER_ID]);
    const upserts = db.writes.filter((w) => w.startsWith('subs:upsert'));
    assert.deepEqual(upserts, ['subs:upsert:["billing_provider","current_period_end","plan","role","updated_at","user_id"]']);
  }
});

test('G4. a renewal counts from the later of the stored end and now; an end already later is never shortened', async () => {
  const POST = await load(); fresh();
  db.subs.set(USER_ID, { user_id: USER_ID, role: 'pro', current_period_end: new Date(addDays(10)).toISOString(), billing_provider: 'whop' });
  await POST(req(pay({}, { id: 'pay_renew', plan: { id: PLAN.m } })));
  const d = daysFromNow(db.subs.get(USER_ID)!.current_period_end);
  assert.ok(d > 38 && d < 42, `a renewal 10 days before the end should reach ~40 days out, got ${d}`);
  // a lapsed account counts from now, not from its old end
  fresh();
  db.subs.set(USER_ID, { user_id: USER_ID, role: 'free', current_period_end: new Date(addDays(-60)).toISOString(), billing_provider: 'whop' });
  await POST(req(pay({}, { id: 'pay_lapsed' })));
  const d2 = daysFromNow(db.subs.get(USER_ID)!.current_period_end);
  assert.ok(d2 > 28 && d2 < 32, `a lapsed account should get ~30 days from now, got ${d2}`);
});

test('G5. one purchase sends a payment event AND a membership event: Pro is granted ONCE', async () => {
  const POST = await load(); fresh();
  await POST(req(pay()));
  const end1 = db.subs.get(USER_ID)!.current_period_end;
  const mem = await POST(req(JSON.stringify({ id: 'msg_m', type: 'membership.activated', data: { id: 'mem_1', status: 'active', user: { email: USER_EMAIL }, plan: { id: PLAN.m } } })));
  assert.equal((await body(mem)).ignored, 'membership_event_never_grants_or_revokes');
  assert.equal(db.subs.get(USER_ID)!.current_period_end, end1, 'the membership event moved the end date');
});

test('G5b. the SAME payment arriving in a second body (different bytes, different message id) is counted once', async () => {
  const POST = await load(); fresh();
  await POST(req(pay()));
  const end1 = db.subs.get(USER_ID)!.current_period_end;
  const again = await POST(req(pay({ extra: 1 })));
  assert.equal((await body(again)).ignored, 'payment_already_counted');
  assert.equal(db.subs.get(USER_ID)!.current_period_end, end1, 'a repeat of one payment extended the period');
  assert.equal(db.writes.filter((w) => w.startsWith('subs:upsert')).length, 1);
});

test('G5c. two deliveries of the same payment racing each other grant exactly once', async () => {
  const POST = await load(); fresh();
  const [a, b] = await Promise.all([POST(req(pay({ extra: 'a' }), {})), POST(req(pay({ extra: 'b' })))]);
  const answers = [await body(a), await body(b)];
  assert.equal(answers.filter((x) => x.granted).length, 1, JSON.stringify(answers));
  assert.equal(db.writes.filter((w) => w.startsWith('subs:upsert')).length, 1);
  const d = daysFromNow(db.subs.get(USER_ID)!.current_period_end);
  assert.ok(d > 28 && d < 32, `one month expected, got ${d} days`);
});

test('G6. month-end arithmetic: one month from the 31st lands on the last day of the next month, a year from a leap day on the 28th', () => {
  const add1 = { months: 1 }; const add12 = { months: 12 };
  assert.equal(extendedPeriodEnd(null, new Date('2026-01-31T10:00:00Z'), add1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(extendedPeriodEnd(null, new Date('2028-01-31T10:00:00Z'), add1).toISOString().slice(0, 10), '2028-02-29');
  assert.equal(extendedPeriodEnd(null, new Date('2028-02-29T10:00:00Z'), add12).toISOString().slice(0, 10), '2029-02-28');
  assert.equal(extendedPeriodEnd(null, new Date('2026-12-15T10:00:00Z'), { days: 14 }).toISOString().slice(0, 10), '2026-12-29');
  // a stored end in the future is the base; a stored end in the past or garbage is ignored
  const now = new Date('2026-06-01T00:00:00Z');
  assert.equal(extendedPeriodEnd('2026-06-11T00:00:00Z', now, { days: 14 }).toISOString().slice(0, 10), '2026-06-25');
  assert.equal(extendedPeriodEnd('2026-01-01T00:00:00Z', now, { days: 14 }).toISOString().slice(0, 10), '2026-06-15');
  assert.equal(extendedPeriodEnd('not a date', now, { days: 14 }).toISOString().slice(0, 10), '2026-06-15');
});

/* ── grants nothing ────────────────────────────────────────────────────── */

test('N1. bad signature, missing headers, stale timestamp, a one-byte change, secret unset: 401 and nothing is written or reported', async () => {
  let POST = await load(); fresh();
  const b = pay();
  const cases = [req(b, { sig: 'v1,AAAA' }), req(b, { sig: null }), req(b, { ts: Math.floor(Date.now() / 1000) - 3600 }), (() => { const r = req(b); return new NextRequest(r.url, { method: 'POST', body: b + ' ', headers: r.headers }); })()];
  for (const c of cases) assert.equal((await POST(c)).status, 401);
  POST = await load({ WHOP_WEBHOOK_SECRET: undefined });
  assert.equal((await POST(req(b))).status, 401, 'with no secret set even a correctly signed request must be refused');
  assert.equal(db.writes.length, 0); assert.equal(reviews().length, 0); assert.equal(db.tables.size, 0, 'a refused request reached the database');
});

test('N2. the hidden $1 test plan is recorded and grants nothing and is not reported; unknown, near-miss and wrong-case plan ids go to review', async () => {
  const POST = await load(); fresh();
  let r = await POST(req(pay({}, { plan: { id: TEST_PLAN } })));
  assert.equal((await body(r)).ignored, 'test_plan_record_only'); assert.equal(db.subs.size, 0); assert.equal(reviews().length, 0); assert.equal(db.events.size, 1);
  for (const id of ['plan_UNKNOWN', PLAN.m.slice(0, -1) + 'x', PLAN.m.toLowerCase(), PLAN.m + ' x']) {
    fresh(); r = await POST(req(pay({}, { plan: { id } })));
    assert.match(String((await body(r)).review), /^unknown_plan:/, id); assert.equal(db.subs.size, 0); assert.equal(reviews().length, 1);
  }
  const POST2 = await load({ WHOP_TEST_PLAN_ID: 'plan_QA_SANDBOX_TEST' }); fresh();
  r = await POST2(req(pay({}, { plan: { id: 'plan_QA_SANDBOX_TEST' } })));
  assert.equal((await body(r)).ignored, 'test_plan_record_only', 'the sandbox copy of the test plan must be record-only too');
});

test('N2b. a plan id given to two plans, set as the test plan, or not set at all is not a Pro plan: nothing grants', async () => {
  fresh();
  let POST = await load({ WHOP_PLAN_ID_ANNUAL: PLAN.m });
  let r = await POST(req(pay())); assert.match(String((await body(r)).review), /^unknown_plan/);
  fresh(); POST = await load({ WHOP_PLAN_ID_MONTHLY: TEST_PLAN });
  r = await POST(req(pay({}, { plan: { id: TEST_PLAN } }))); assert.equal((await body(r)).ignored, 'test_plan_record_only'); assert.equal(db.subs.size, 0);
  // production today: the plan ids are not set there, so a valid, paid, correctly signed payment grants nothing
  fresh(); POST = await load({ WHOP_PLAN_ID_MONTHLY: undefined, WHOP_PLAN_ID_ANNUAL: undefined, WHOP_PLAN_ID_FORTNIGHTLY: undefined });
  r = await POST(req(pay())); assert.match(String((await body(r)).review), /^unknown_plan/); assert.equal(db.subs.size, 0);
  assert.equal(deliveries(), 1, 'it must still be recorded');
});

test('N2c. the plan table itself never holds the hidden test plan, the sandbox test plan, a duplicated id or a blank (a second line of defence behind the rule in N2)', () => {
  const t = whopPlanTable({ WHOP_PLAN_ID_MONTHLY: TEST_PLAN, WHOP_PLAN_ID_ANNUAL: 'plan_QA_SANDBOX_TEST', WHOP_PLAN_ID_FORTNIGHTLY: '  ', WHOP_TEST_PLAN_ID: 'plan_QA_SANDBOX_TEST' });
  assert.deepEqual(Object.keys(t), []);
  assert.deepEqual(Object.keys(whopPlanTable({ WHOP_PLAN_ID_MONTHLY: 'plan_a', WHOP_PLAN_ID_ANNUAL: 'plan_b', WHOP_PLAN_ID_FORTNIGHTLY: 'plan_c' })).sort(), ['plan_a', 'plan_b', 'plan_c']);
  assert.equal(whopPlanTable({ WHOP_PLAN_ID_MONTHLY: 'plan_a' }).plan_a.plan, 'monthly');
  assert.deepEqual(Object.keys(whopPlanTable({})), [], 'with nothing set (production today) there is no Pro plan');
});

test('N3. no account, a look-alike address, a +tag address, an unconfirmed account: review and no grant; a padded, differently-cased address of the real account grants', async () => {
  const POST = await load();
  for (const email of ['nobody@example.test', 'buyer+tag@example.test', 'buyer@example.test.evil.test', 'buyer@exarnple.test']) {
    fresh(); const r = await POST(req(pay({}, { user: { email } })));
    assert.equal((await body(r)).review, 'no_account_for_payer_email', email); assert.equal(db.subs.size, 0);
  }
  fresh(); const r1 = await POST(req(pay({}, { user: { email: '  BUYER@Example.TEST ' } }))); assert.equal((await body(r1)).granted, 'monthly');
  fresh(); db.users.get(USER_ID)!.email_confirmed_at = null;
  const r2 = await POST(req(pay())); assert.equal((await body(r2)).review, 'account_email_not_confirmed'); assert.equal(db.subs.size, 0);
});

test('N5. $0, no amount, a non-USD charge, not paid, a refunded substatus, no email, no payment id: review and no grant', async () => {
  const POST = await load();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['zero', { total: 0, usd_total: 0 }], ['no amount', { total: undefined, usd_total: undefined }], ['eur and no usd_total', { usd_total: undefined, currency: 'eur' }],
    ['not paid', { status: 'open' }], ['refunded', { substatus: 'refunded' }], ['no status', { status: undefined }], ['no email', { user: { id: 'u' } }], ['null user', { user: null }], ['no payment id', { id: undefined }],
    ['amount as text', { usd_total: '49', total: '49' }], ['negative', { usd_total: -49, total: -49 }],
  ];
  for (const [name, over] of cases) { fresh(); const r = await POST(req(pay({}, over))); const b = await body(r); assert.ok(b.review, `${name}: ${JSON.stringify(b)}`); assert.equal(db.subs.size, 0, name); }
});

test('N5b. PINNED, KNOWN: any charge above zero on a known plan grants the full period (the amount is not compared with the price, because the unit is undocumented). If this goes red, the price rule changed: tell the owner.', async () => {
  const POST = await load(); fresh();
  const r = await POST(req(pay({}, { total: 0.01, usd_total: 0.01 })));
  assert.equal((await body(r)).granted, 'monthly');
});

test('N6. the exact same delivery again, re-signed with a new timestamp: answered "replay", one record, one grant', async () => {
  const POST = await load(); fresh(); const b = pay();
  await POST(req(b, { id: 'msg_same', ts: Math.floor(Date.now() / 1000) - 5 }));
  const end = db.subs.get(USER_ID)!.current_period_end;
  const r = await POST(req(b, { id: 'msg_same', ts: Math.floor(Date.now() / 1000) }));
  assert.equal((await body(r)).ignored, 'replay'); assert.equal(deliveries(), 1); assert.equal(db.subs.get(USER_ID)!.current_period_end, end);
});

test('N7. the grant write fails: the answer is 500, the record is removed, and the RETRY grants (a stranded paying customer is the failure this guards)', async () => {
  const POST = await load(); fresh(); const b = pay();
  db.fail = 'subsWrite';
  const r = await POST(req(b, { id: 'msg_retry' }));
  assert.equal(r.status, 500); assert.equal(db.events.size, 0, 'the record must be removed so the retry is not answered "replay"'); assert.equal(db.subs.size, 0);
  db.fail = null;
  const r2 = await POST(req(b, { id: 'msg_retry' }));
  assert.equal(r2.status, 200); assert.equal((await body(r2)).granted, 'monthly'); assert.equal(db.subs.get(USER_ID)!.role, 'pro');
});

test('N7b. every read the grant depends on can fail (payment-id check, account lookup, account read, subscription read): 500, record removed, nothing granted, and the retry grants', async () => {
  const POST = await load();
  for (const fail of ['earliest', 'rpc', 'auth', 'subsRead'] as const) {
    fresh(); const b = pay(); db.fail = fail;
    const r = await POST(req(b, { id: `msg_${fail}` }));
    assert.equal(r.status, 500, `${fail}: ${r.status}`); assert.equal(db.events.size, 0, `${fail}: the record must be removed`); assert.equal(db.subs.size, 0, `${fail}: granted despite the failure`);
    db.fail = null;
    const r2 = await POST(req(b, { id: `msg_${fail}` }));
    assert.equal((await body(r2)).granted, 'monthly', `${fail}: the retry must grant`);
  }
});

/* ── never revokes ─────────────────────────────────────────────────────── */

test('V1. membership, cancel, failed payment, unknown events: recorded and never touch the subscription row; refund and dispute events are reported for a person and never act', async () => {
  const POST = await load(); fresh();
  db.subs.set(USER_ID, { user_id: USER_ID, role: 'pro', current_period_end: new Date(addDays(5)).toISOString(), billing_provider: 'whop' });
  const before = JSON.stringify(db.subs.get(USER_ID));
  for (const type of ['membership.deactivated', 'membership.updated', 'payment.failed', 'payment.pending', 'something.new']) {
    const r = await POST(req(JSON.stringify({ id: 'msg_' + type, type, data: { id: 'x_' + type, status: 'canceled', user: { email: USER_EMAIL }, plan: { id: PLAN.m } } })));
    assert.equal(r.status, 200); assert.ok((await body(r)).ignored, type);
  }
  for (const type of ['refund.created', 'dispute.created']) {
    const r = await POST(req(JSON.stringify({ id: 'msg_' + type, type, data: { id: 'x_' + type } })));
    assert.match(String((await body(r)).review), /flagged_not_revoked/);
  }
  assert.equal(JSON.stringify(db.subs.get(USER_ID)), before, 'a non-payment event changed the subscription');
  assert.equal(reviews().length, 2);
  assert.ok(db.writes.every((w) => !w.startsWith('subs:')), db.writes.join());
});

test('V2. a refunded or failed copy of a payment that already granted does not undo it', async () => {
  const POST = await load(); fresh();
  await POST(req(pay()));
  const before = JSON.stringify(db.subs.get(USER_ID));
  await POST(req(pay({ type: 'payment.failed' }, { status: 'failed' })));
  await POST(req(pay({ type: 'payment.succeeded' }, { id: 'pay_1', substatus: 'refunded' })));
  assert.equal(JSON.stringify(db.subs.get(USER_ID)), before);
});

test('V3. an admin grant (Pro, no end date, no processor) is review and is not touched; an account on another processor\'s paid time is extended, not replaced', async () => {
  const POST = await load(); fresh();
  db.subs.set(USER_ID, { user_id: USER_ID, role: 'pro', current_period_end: null, billing_provider: null });
  const r = await POST(req(pay())); assert.equal((await body(r)).review, 'account_has_admin_grant'); assert.equal(db.subs.get(USER_ID)!.current_period_end, null);
  fresh();
  db.subs.set(USER_ID, { user_id: USER_ID, role: 'pro', current_period_end: new Date(addDays(20)).toISOString(), billing_provider: 'lemonsqueezy' });
  const r2 = await POST(req(pay()));
  assert.equal((await body(r2)).granted, 'monthly');
  assert.ok(daysFromNow(db.subs.get(USER_ID)!.current_period_end) > 48, 'paid time already owed was lost');
});

test('V4. across every case the route touched only the events table, the subscriptions table and the two account lookups, and only ever inserted, deleted its own record, or upserted a Pro row', async () => {
  const POST = await load(); fresh();
  for (const b of [pay(), pay({ extra: 1 }), pay({}, { id: 'pay_2', plan: { id: PLAN.a } }), pay({}, { id: 'pay_3', plan: { id: 'plan_x' } }), pay({ type: 'refund.created' })]) await POST(req(b));
  assert.deepEqual([...db.tables].sort(), [T('user_subscriptions'), T('whop_webhook_events')].sort());
  assert.ok(db.writes.every((w) => w === 'events:insert' || w === 'events:delete' || w.startsWith('subs:upsert')), db.writes.join());
  assert.equal(db.subs.get(USER_ID)!.role, 'pro');
});

/* ── gate, secrecy, shape ──────────────────────────────────────────────── */

test('X1. no report and no response contains the buyer\'s address, name or the secret', async () => {
  const POST = await load(); fresh();
  const seen: string[] = [];
  for (const b of [pay({}, { plan: { id: 'plan_x' } }), pay({}, { user: { email: 'nobody@example.test', name: 'Zed Buyer' } }), pay({ type: 'refund.created' }), pay()]) {
    const r = await POST(req(b)); seen.push(await r.text());
  }
  const reports = sentry().map((a) => String((a[0] as Error)?.message)).join('\n');
  for (const text of [reports, ...seen]) { assert.ok(!/@/.test(text), 'an address leaked: ' + text.slice(0, 120)); assert.ok(!text.includes(SECRET), 'the secret leaked'); assert.ok(!/Zed Buyer/.test(text)); }
  assert.ok(reviews().length >= 2);
});

test('X2. hostile bodies never crash the route and never grant; a company id that does not match review-fails, one that matches grants, unset is not checked', async () => {
  fresh(); let POST = await load({ WHOP_COMPANY_ID: 'biz_other' });
  let r = await POST(req(pay())); assert.equal((await body(r)).review, 'company_does_not_match');
  fresh(); POST = await load({ WHOP_COMPANY_ID: 'biz_ours' }); r = await POST(req(pay())); assert.equal((await body(r)).granted, 'monthly');
  fresh(); POST = await load();
  for (const hostile of ['{}', '{"type":"payment.succeeded"}', '{"type":"payment.succeeded","data":[]}', '{"type":"payment.succeeded","data":{"plan":"x","user":7,"usd_total":"49"}}', '{"type":5}', '[]', 'not json']) {
    const rr = await POST(req(hostile)); assert.ok([200, 400].includes(rr.status), hostile + ' -> ' + rr.status);
  }
  assert.equal(db.subs.size, 0);
});

test('X3. source: only POST is exported, the only role the route can write is \'pro\', and the only table it deletes from is its own events table', () => {
  const src = stripTsComments(read('app/api/whop/webhook/route.ts'));
  const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported, ['POST']);
  for (const m of src.matchAll(/role\s*:\s*(['"`])(\w+)\1/g)) assert.equal(m[2], 'pro', `the route writes role ${m[2]}`);
  assert.ok(!/\.delete\(\)[\s\S]{0,120}user_subscriptions/.test(src) && !/user_subscriptions[\s\S]{0,120}\.delete\(\)/.test(src), 'the route deletes subscription rows');
  const deletes = [...src.matchAll(/\.from\(([^)]+)\)\s*\.delete\(\)/g)].map((m) => m[1].trim());
  assert.ok(deletes.every((d) => d === 'T.whop_webhook_events'), deletes.join());
});

test('X4. /api/version reports which plan ids are set as booleans and never the ids themselves', () => {
  const env = { WHOP_PLAN_ID_MONTHLY: PLAN.m, WHOP_PLAN_ID_ANNUAL: undefined, WHOP_PLAN_ID_FORTNIGHTLY: '  ', WHOP_WEBHOOK_SECRET: SECRET } as Record<string, string | undefined>;
  const flags = configuredFlags(env) as unknown as Record<string, unknown>;
  assert.equal(flags.whopPlanMonthly, true); assert.equal(flags.whopPlanAnnual, false); assert.equal(flags.whopPlanFortnightly, false);
  const dump = JSON.stringify(flags);
  assert.ok(!dump.includes(PLAN.m) && !dump.includes(SECRET), 'a plan id or the secret appears in the flags');
  // the same id on two plans is not "set" for either
  const both = configuredFlags({ WHOP_PLAN_ID_MONTHLY: 'plan_same', WHOP_PLAN_ID_ANNUAL: 'plan_same' } as Record<string, string | undefined>) as unknown as Record<string, unknown>;
  assert.equal(both.whopPlanMonthly, false); assert.equal(both.whopPlanAnnual, false);
});
