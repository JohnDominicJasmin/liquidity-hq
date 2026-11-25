/* QA: PR #2802 (#1632 owner item 5), a push subscription is Pro only, belongs to its account and is capped at 10. The REAL route runs; only the network is a stand-in (Auth, the plan row and an in-memory subscriptions table that behaves like PostgREST for the verbs the route uses).
 *   P1 a Free account: 403 PRO_REQUIRED, nothing written; an active trial and a paid account are let in
 *   P2 an unreadable plan: 503, nothing written
 *   P3 an endpoint held by another account: different keys 409 and unchanged; the same keys (same browser) 200 and it moves
 *   P4 with 10 stored, an 11th is stored and only the OLDEST other one is removed
 *   P5 subscribing an endpoint already held (the oldest) at the cap removes nothing, and another account's rows are never counted or removed
 *   P6 unsubscribing is not gated by plan
 * WHAT IT CANNOT PROVE: the database's own unique constraint and policies, or a real browser subscription. */
import test, { after, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = () => {}; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const UID = '77777777-7777-4777-8777-777777777777', OTHER = '88888888-8888-4888-8888-888888888888', TOKEN = 'qa-token';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sub = { user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string };
const world = { plan: { role: 'pro', trial_ends_at: null, current_period_end: null } as Record<string, unknown>, planFails: false, subs: [] as Sub[], writes: [] as string[], stray: [] as string[] };
let clock = Date.UTC(2026, 0, 1);
const stamp = () => new Date((clock += 60_000)).toISOString();

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url), p = url.pathname, m = req.method;
  if (url.origin !== SUPABASE) { world.stray.push(url.host); throw new Error(`stray request ${req.url}`); }
  if (p === '/auth/v1/user') return json(200, { id: UID, email: 'qa@example.test', aud: 'authenticated', role: 'authenticated' });
  const single = (req.headers.get('accept') ?? '').includes('vnd.pgrst.object');
  const rows = (r: unknown[]) => (single ? (r.length ? json(200, r[0]) : json(406, { code: 'PGRST116', details: 'Results contain 0 rows', message: 'no rows' })) : json(200, r));
  if (p.endsWith('user_status')) return rows([{ banned: false }]);
  if (p.endsWith('user_subscriptions')) return world.planFails ? json(500, { code: 'XX000', message: 'plan read failed' }) : rows([world.plan]);
  if (p.endsWith('push_subscriptions')) {
    const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '');
    const inList = url.searchParams.get('endpoint')?.match(/^in\.\((.*)\)$/)?.[1]?.split(',').map((s) => s.replace(/^"|"$/g, ''));
    const match = (s: Sub) => (eq('user_id') === undefined || s.user_id === eq('user_id')) && (inList ? inList.includes(s.endpoint) : eq('endpoint') === undefined || s.endpoint === eq('endpoint'));
    if (m === 'GET') {
      let found = world.subs.filter(match);
      if ((url.searchParams.get('order') ?? '').startsWith('created_at.desc')) found = [...found].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows(found);
    }
    const body = m === 'DELETE' ? null : JSON.parse(await req.text()) as Partial<Sub> | Partial<Sub>[];
    world.writes.push(`${m} ${url.search}`);
    if (m === 'POST') for (const row of ([] as Partial<Sub>[]).concat(body!)) {
      const have = world.subs.find((s) => s.endpoint === row.endpoint);
      if (have) Object.assign(have, row); else world.subs.push({ ...(row as Sub), created_at: stamp() });
    }
    if (m === 'DELETE') world.subs = world.subs.filter((s) => !match(s));
    return new Response(null, { status: m === 'DELETE' ? 204 : 201 });
  }
  if (p.includes('api_health')) return new Response(null, { status: 201 });
  world.stray.push(`${m} ${p}`);
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const routeP = import('../app/api/push/subscribe/route.ts');
const ep = (n: string) => `https://fcm.googleapis.com/fcm/send/qa-${n}`;
const req = (method: 'POST' | 'DELETE', body: unknown) => new NextRequest('http://localhost/api/push/subscribe', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` } });
const subscribe = async (name: string, keys = { p256dh: 'pk', auth: 'ak' }) => { const r = await (await routeP).POST(req('POST', { endpoint: ep(name), keys })); return { status: r.status, body: await r.json() as { error?: string; code?: string } }; };
const held = (user: string, name: string, keys = { p256dh: 'pk', auth: 'ak' }): Sub => ({ user_id: user, endpoint: ep(name), ...keys, created_at: stamp() });
const mine = () => world.subs.filter((s) => s.user_id === UID).map((s) => s.endpoint).sort();

beforeEach(() => { world.plan = { role: 'pro', trial_ends_at: null, current_period_end: null }; world.planFails = false; world.subs = []; world.writes = []; world.stray = []; });

test('P1. Free is refused with PRO_REQUIRED and nothing is written; a paid account and an active trial are let in', async () => {
  world.plan = { role: 'free', trial_ends_at: null, current_period_end: null };
  const r = await subscribe('a');
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRO_REQUIRED'); assert.deepEqual(world.writes, []); assert.deepEqual(world.subs, []);
  world.plan = { role: 'free', trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(), current_period_end: null };
  assert.equal((await subscribe('trial')).status, 200, 'an active trial was refused');
  world.plan = { role: 'pro', trial_ends_at: null, current_period_end: null };
  assert.equal((await subscribe('paid')).status, 200);
  assert.deepEqual(mine(), [ep('paid'), ep('trial')].sort()); assert.deepEqual(world.stray, [], 'CONTROL: the stand-in answered everything');
});

test('P2. an unreadable plan is 503, never a refusal as Free, and nothing is written', async () => {
  world.planFails = true;
  const r = await subscribe('a');
  assert.equal(r.status, 503); assert.equal(r.body.code, 'UNAVAILABLE'); assert.deepEqual(world.writes, []);
});

test('P3. another account\'s endpoint moves only with the same keys', async () => {
  for (const keys of [{ p256dh: 'other', auth: 'ak' }, { p256dh: 'pk', auth: 'other' }]) {
    world.subs = [held(OTHER, 'shared')]; world.writes = [];
    const r = await subscribe('shared', keys);
    assert.equal(r.status, 409, JSON.stringify(keys)); assert.deepEqual(world.writes, []); assert.equal(world.subs[0].user_id, OTHER); assert.equal(world.subs[0].p256dh, 'pk');
  }
  world.subs = [held(OTHER, 'shared')];
  assert.equal((await subscribe('shared')).status, 200, 'the same browser could not move its own subscription');
  assert.equal(world.subs.length, 1); assert.equal(world.subs[0].user_id, UID);
});

test('P4. an 11th subscription is stored and only the oldest is removed', async () => {
  world.subs = Array.from({ length: 10 }, (_, i) => held(UID, `s${i}`));
  world.subs.push(held(OTHER, 'theirs'));
  assert.equal((await subscribe('new')).status, 200);
  assert.deepEqual(mine(), [...Array.from({ length: 9 }, (_, i) => ep(`s${i + 1}`)), ep('new')].sort());
  assert.ok(world.subs.some((s) => s.endpoint === ep('theirs')), 'another account\'s row was removed');
});

test('P5. subscribing the oldest endpoint again at the cap removes nothing', async () => {
  world.subs = Array.from({ length: 10 }, (_, i) => held(UID, `s${i}`));
  assert.equal((await subscribe('s0')).status, 200);
  assert.equal(mine().length, 10); assert.ok(mine().includes(ep('s0')), 'the row just stored was dropped as the oldest');
  assert.equal(world.writes.filter((w) => w.startsWith('DELETE')).length, 0);
});

test('P6. unsubscribing works for a Free account', async () => {
  world.plan = { role: 'free', trial_ends_at: null, current_period_end: null }; world.subs = [held(UID, 'old'), held(OTHER, 'theirs')];
  const r = await (await routeP).DELETE(req('DELETE', { endpoint: ep('old') }));
  assert.equal(r.status, 200); assert.deepEqual(world.subs.map((s) => s.endpoint), [ep('theirs')]);
});
