/* #1648 (#1632 follow-up): a real account never meets the 1,000-row price-alert cap, because creating an alert prunes that account's OLDEST
 * switched-off alerts once it holds 900 rows, back down to 800. Active alerts are never touched.
 *
 * THE REAL ROUTE RUNS HERE: POST from app/api/price-alerts/route.ts with a bearer token. The network is an in-memory PostgREST that knows the
 * price-alert table (count/head, filters, order, limit, delete by id list), the subscription row the Pro gate reads, and the auth user.
 *
 * WHAT THIS PINS: under 900 rows no delete is sent; at 900 exactly total - 800 of the OLDEST inactive rows of THIS user are deleted; with fewer
 * inactive rows than that, only inactive rows go; active rows and other users' rows are never in a delete; a failed prune does not block the new
 * alert; the 51st active alert is refused before any prune or insert; the numbers are 1000 / 900 / 800.
 *
 * WHAT IT CANNOT PROVE: real PostgREST/RLS behaviour for the delete (the stand-in imitates the filters), or the database trigger caps themselves
 * (the live check in QA's window, #1632). No real credentials, no real database: the Supabase URL is a `.invalid` host. */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
const ME = '55555555-5555-4555-8555-555555555555'; const OTHER = '66666666-6666-4666-8666-666666666666';
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
type Alert = { id: string; user_id: string; active: boolean; created_at: string };
const db = { alerts: [] as Alert[], deletes: [] as { user: string; ids: string[] }[], failSelect: false, seq: 0,
  reset() { this.alerts = []; this.deletes = []; this.failSelect = false; this.seq = 0; },
  /* activeFirst: the ACTIVE rows are the oldest ones, so a prune that forgot the active=false filter would take them (the case P3 needs). */
  seed(user: string, active: number, inactive: number, activeFirst = false) {
    const add = (on: boolean, k: number) => { for (let i = 0; i < k; i++) this.alerts.push({ id: `${user.slice(0, 4)}-${on ? 'on' : 'off'}-${this.seq}`, user_id: user, active: on, created_at: new Date(Date.UTC(2026, 0, 1) + this.seq++ * 60_000).toISOString() }); };
    if (activeFirst) { add(true, active); add(false, inactive); } else { add(false, inactive); add(true, active); }
  } };
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); if (url.origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  const p = url.pathname; const q = url.searchParams;
  if (p === '/auth/v1/user') return (req.headers.get('authorization') ?? '').endsWith('tok_me') ? json(200, { id: ME, aud: 'authenticated', email: 'me@example.test' }) : json(401, { message: 'bad jwt' });
  if (p === `/rest/v1/${T('user_subscriptions')}`) { const row = { role: 'pro', trial_ends_at: null, current_period_end: null }; return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]); }
  if (p === `/rest/v1/${T('price_alerts')}`) {
    let rows = [...db.alerts];
    const eqv = (k: string) => (q.get(k) ?? '').replace(/^eq\./, '');
    if (q.get('user_id')) rows = rows.filter((r) => r.user_id === eqv('user_id'));
    if (q.get('active')) rows = rows.filter((r) => String(r.active) === eqv('active'));
    if (req.method === 'HEAD' || (req.method === 'GET' && (req.headers.get('prefer') ?? '').includes('count=exact'))) return new Response(null, { status: 200, headers: { 'content-range': `*/${rows.length}` } });
    if (req.method === 'GET') {
      if (db.failSelect) return json(500, { code: 'XX000', message: 'select failed (stand-in)' });
      const ord = q.get('order') ?? '';
      if (ord.startsWith('created_at.asc')) rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      else if (ord.startsWith('created_at.desc')) rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      else rows.reverse(); // no order asked: the database promises none, so the stand-in answers newest-first rather than flattering the caller
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
      return json(200, rows.map((r) => ({ id: r.id })));
    }
    if (req.method === 'DELETE') {
      const ids = ((q.get('id') ?? '').match(/^in\.\((.*)\)$/)?.[1] ?? '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
      db.deletes.push({ user: eqv('user_id'), ids });
      db.alerts = db.alerts.filter((r) => !(r.user_id === eqv('user_id') && ids.includes(r.id)));
      return new Response(null, { status: 204 });
    }
    if (req.method === 'POST') {
      const row = JSON.parse(await req.text()); const a = { id: `new-${db.seq++}`, active: true, created_at: new Date().toISOString(), ...row };
      db.alerts.push(a); return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(201, a) : json(201, [a]);
    }
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const { POST } = await import('../app/api/price-alerts/route.ts');
const { PRICE_ALERT_ROW_CAP, PRICE_ALERT_PRUNE_AT, PRICE_ALERT_PRUNE_TO, ACTIVE_ALERT_CAP } = await import('../lib/ownRowLimits.ts');
const create = () => POST(new NextRequest('http://localhost/api/price-alerts', { method: 'POST', headers: { authorization: 'Bearer tok_me', 'content-type': 'application/json' }, body: JSON.stringify({ coin: 'btc', target_price: '9999999', direction: 'above', label: 'qa' }) }));

test('N1. the numbers: cap 1000, prune at 900, prune to 800, 50 active', () => {
  assert.deepEqual([PRICE_ALERT_ROW_CAP, PRICE_ALERT_PRUNE_AT, PRICE_ALERT_PRUNE_TO, ACTIVE_ALERT_CAP], [1000, 900, 800, 50]);
});

test('P1. under 900 rows no delete is sent and the alert is created', async () => {
  db.reset(); db.seed(ME, 10, 889);
  const r = await create(); assert.equal(r.status, 200);
  assert.equal(db.deletes.length, 0);
});

test('P2. at 900 rows exactly total - 800 of the OLDEST inactive rows of this user are deleted, then the alert is created', async () => {
  db.reset(); db.seed(ME, 30, 870); db.seed(OTHER, 5, 500);
  const oldest = db.alerts.filter((a) => a.user_id === ME && !a.active).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 100).map((a) => a.id);
  const r = await create(); assert.equal(r.status, 200);
  assert.equal(db.deletes.length, 1); assert.equal(db.deletes[0].user, ME);
  assert.deepEqual(db.deletes[0].ids, oldest, 'not the 100 oldest inactive rows');
  assert.equal(db.alerts.filter((a) => a.user_id === ME).length, 801);
  assert.equal(db.alerts.filter((a) => a.user_id === OTHER).length, 505, 'another account lost rows');
});

test('P3. with fewer inactive rows than the excess, only inactive rows go; active rows are never deleted', async () => {
  db.reset(); db.seed(ME, 45, 905, true);   // 950 rows, only 905 inactive; excess 150; the 45 ACTIVE rows are the oldest
  const activeBefore = db.alerts.filter((a) => a.active).map((a) => a.id);
  await create();
  const deleted = db.deletes.flatMap((d) => d.ids);
  assert.equal(deleted.length, 150);
  assert.ok(deleted.every((id) => id.includes('-off-')), 'an active alert was in the delete');
  assert.ok(activeBefore.every((id) => db.alerts.some((a) => a.id === id)), 'an active alert disappeared');
});

test('P4. a failed prune does not block the new alert', async () => {
  db.reset(); db.seed(ME, 5, 900); db.failSelect = true;
  const r = await create(); assert.equal(r.status, 200, 'a prune failure refused the new alert');
  assert.equal(db.deletes.length, 0);
});

test('P5. the 51st active alert is refused before any prune or insert', async () => {
  db.reset(); db.seed(ME, 50, 860);
  const before = db.alerts.length; const r = await create();
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'ALERT_LIMIT');
  assert.equal(db.deletes.length, 0); assert.equal(db.alerts.length, before);
});
