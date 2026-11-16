/* #2425 B5: an EDITED price alert is armed again FROM THE EDIT. The evaluator treats created_at as "set after": a wick from before the alert was set must not fire it, and editing the target or the direction
 * changes what the alert IS, so a 1-minute candle that touched the NEW level before the edit must not fire it either. So the PATCH stamps created_at with the time of the edit.
 *
 * THE REAL ROUTE RUNS: PATCH from app/api/price-alerts/route.ts with a bearer token, against an in-memory PostgREST that knows the price-alert table (update by id + user, returning the row), the subscription
 * row the Pro gate reads, and the auth user. WHAT IT PINS: a target edit and a direction edit each send created_at = about now (not the old value, not missing); the stamp is the time of the edit when the clock
 * moves; a refused edit (bad value, nothing to update, another account's alert) sends no write. WHAT IT CANNOT PROVE: that the evaluator then ignores the earlier wick (the cron cells in
 * priceAlertCron.test.mts and priceAlertEval.test.mts own that). */
import test, { after, beforeEach } from 'node:test';
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
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Row = { id: number; user_id: string; coin: string; target_price: number; direction: string; active: boolean; created_at: string };
const OLD = '2026-01-01T00:00:00.000Z';
const db = { rows: [] as Row[], patches: [] as Array<Record<string, unknown>>,
  reset() { this.rows = [{ id: 1, user_id: ME, coin: 'btc', target_price: 100000, direction: 'above', active: true, created_at: OLD }, { id: 2, user_id: OTHER, coin: 'btc', target_price: 90000, direction: 'below', active: true, created_at: OLD }]; this.patches = []; } };
const T = (n: string) => (process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_') + n;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); if (url.origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  const p = url.pathname; const q = url.searchParams; const eqv = (k: string) => (q.get(k) ?? '').replace(/^eq\./, '');
  if (p === '/auth/v1/user') return (req.headers.get('authorization') ?? '').endsWith('tok_me') ? json(200, { id: ME, aud: 'authenticated', email: 'me@example.test' }) : json(401, { message: 'bad jwt' });
  if (p === `/rest/v1/${T('user_subscriptions')}`) { const row = { role: 'pro', trial_ends_at: null, current_period_end: null }; return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]); }
  if (p === `/rest/v1/${T('price_alerts')}` && req.method === 'PATCH') {
    const patch = JSON.parse(await req.text()) as Record<string, unknown>; db.patches.push(patch);
    const hit = db.rows.find((r) => String(r.id) === eqv('id') && r.user_id === eqv('user_id'));
    if (!hit) return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(406, { code: 'PGRST116', message: 'no rows' }) : json(200, []);
    Object.assign(hit, patch);
    return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, hit) : json(200, [hit]);
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const standInFetch = globalThis.fetch;
beforeEach(() => { assert.equal(globalThis.fetch, standInFetch, 'the fetch stand-in is not installed: this run measures nothing about the route (#1683)'); });

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const { PATCH } = await import('../app/api/price-alerts/route.ts');
const edit = (id: number, body: unknown) => PATCH(new NextRequest(`http://localhost/api/price-alerts?id=${id}`, { method: 'PATCH', headers: { authorization: 'Bearer tok_me', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const near = (iso: unknown, ms = 10_000) => Math.abs(Date.now() - new Date(String(iso)).getTime()) < ms;

test('E1. editing the TARGET stamps created_at with the time of the edit (the alert is armed again from now)', async () => {
  db.reset();
  const before = Date.now();
  const r = await edit(1, { target_price: 95000 });
  assert.equal(r.status, 200);
  assert.equal(db.patches.length, 1); assert.equal(db.patches[0].target_price, 95000);
  assert.ok(typeof db.patches[0].created_at === 'string', 'the edit sent no created_at: a wick from before the edit can fire the new level');
  assert.ok(new Date(String(db.patches[0].created_at)).getTime() >= before - 1000 && near(db.patches[0].created_at), `created_at is not the time of the edit: ${db.patches[0].created_at}`);
  assert.notEqual(db.patches[0].created_at, OLD);
  assert.ok(near(db.rows[0].created_at), 'the stored created_at was not moved to now');
});

test('E2. editing the DIRECTION stamps it too, and the stamp moves forward with the clock (two edits, two different stamps)', async () => {
  db.reset();
  await edit(1, { direction: 'below' });
  assert.ok(near(db.patches[0].created_at), 'a direction edit did not re-arm the alert');
  const first = String(db.patches[0].created_at);
  await new Promise((r) => setTimeout(r, 15));
  await edit(1, { target_price: 90000, direction: 'above' });
  assert.ok(new Date(String(db.patches[1].created_at)).getTime() > new Date(first).getTime(), 'the second edit reused the first stamp');
});

test('E3. an edit that is refused sends NO write: nothing to update, a bad value, a bad direction, and another account\'s alert', async () => {
  db.reset();
  assert.equal((await edit(1, {})).status, 400);
  assert.equal((await edit(1, { target_price: -5 })).status, 400);
  assert.equal((await edit(1, { target_price: 'abc' })).status, 400);
  assert.equal((await edit(1, { direction: 'sideways' })).status, 400);
  assert.equal(db.patches.length, 0, 'a refused edit still reached the database');
  assert.equal((await edit(2, { target_price: 1 })).status, 404);   // someone else's row: the ownership filter matches nothing
  assert.equal(db.rows[1].created_at, OLD, 'another account\'s alert was re-armed');
  assert.equal(db.rows[0].created_at, OLD, 'a refused edit moved created_at');
});
