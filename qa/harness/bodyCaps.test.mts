import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadModule } from '../telegramWorld.mjs';

/* #2344 (G7): per-route request-body caps. The REAL handlers run in-process against the fake network of qa/telegramWorld.mjs.
 * For each route and method: over the cap by a DECLARED content-length -> 413; over the cap STREAMED with no content-length -> 413; a body of EXACTLY the cap is not refused for size (it
 * reaches the route's own validation); invalid JSON is not a 413 (it stays the route's own 400); the 413 body is `Request body too large`.
 * The three paid AI routes are in qa/harness/aiRoutes.test.mts' stub pattern (the counter must not move on a 413): see bodyCapsAi.test.mts.
 * NOT covered: what each route does with a body under the cap (their own cells), and the real database. */

const CAPS = { settings: 65_536, priceAlerts: 4_096, hypothesis: 65_536, evidence: 32_768, alertPrefs: 4_096, pushSubscribe: 8_192 };
const UUID = '00000000-0000-4000-8000-0000000000a1';
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

async function world() {
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: [{ user_id: 'u-pro', ...PRO }], lhq_user_settings: [{ user_id: 'u-pro', telegram_chat_id: '1001', timezone: 'UTC' }],
    lhq_price_alerts: [], lhq_hypotheses: [{ id: UUID, user_id: 'u-pro' }], lhq_hypothesis_evidence: [], lhq_muted_alerts: [], lhq_push_subscriptions: [],
  } });
  installFakeFetch(w); const inner = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'stub.supabase.test' && u.pathname === '/auth/v1/user') {
      const tok = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      return tok === 'tok-pro' ? j({ id: 'u-pro', email: 'pro@example.test', aud: 'authenticated', role: 'authenticated' }) : j({ message: 'invalid JWT' }, 401);
    }
    return inner(input, init);
  };
  return w;
}

type Spec = { name: string; file: string; method: 'POST' | 'PATCH' | 'DELETE'; url: string; cap: number; params?: Record<string, string> };
const SPECS: Spec[] = [
  { name: 'settings PATCH', file: 'app/api/settings/route.ts', method: 'PATCH', url: '/api/settings', cap: CAPS.settings },
  { name: 'price-alerts POST', file: 'app/api/price-alerts/route.ts', method: 'POST', url: '/api/price-alerts', cap: CAPS.priceAlerts },
  { name: 'price-alerts PATCH', file: 'app/api/price-alerts/route.ts', method: 'PATCH', url: '/api/price-alerts?id=1', cap: CAPS.priceAlerts },
  { name: 'alert-prefs POST', file: 'app/api/alert-prefs/route.ts', method: 'POST', url: '/api/alert-prefs', cap: CAPS.alertPrefs },
  { name: 'push/subscribe POST', file: 'app/api/push/subscribe/route.ts', method: 'POST', url: '/api/push/subscribe', cap: CAPS.pushSubscribe },
  { name: 'push/subscribe DELETE', file: 'app/api/push/subscribe/route.ts', method: 'DELETE', url: '/api/push/subscribe', cap: CAPS.pushSubscribe },
  { name: 'hypotheses POST', file: 'app/api/hypotheses/route.ts', method: 'POST', url: '/api/hypotheses', cap: CAPS.hypothesis },
  { name: 'hypotheses/[id] PATCH', file: 'app/api/hypotheses/[id]/route.ts', method: 'PATCH', url: `/api/hypotheses/${UUID}`, cap: CAPS.hypothesis, params: { id: UUID } },
  { name: 'hypotheses/[id]/evidence POST', file: 'app/api/hypotheses/[id]/evidence/route.ts', method: 'POST', url: `/api/hypotheses/${UUID}/evidence`, cap: CAPS.evidence, params: { id: UUID } },
];

/** A JSON object body of EXACTLY `bytes` bytes (ASCII padding), so the cap boundary is measured to the byte. */
const exactly = (bytes: number) => { const head = '{"pad":"'; const tail = '"}'; return head + 'a'.repeat(bytes - head.length - tail.length) + tail; };
const send = async (s: Spec, mod: any, body: BodyInit | null, headers: Record<string, string> = {}, stream = false) => {
  const { NextRequest } = await import('next/server.js');
  const init: Record<string, unknown> = { method: s.method, headers: { 'content-type': 'application/json', authorization: 'Bearer tok-pro', ...headers } };
  if (stream) { init.body = body; init.duplex = 'half'; } else init.body = body;
  const res = await mod[s.method](new NextRequest(`http://localhost${s.url}`, init as never), s.params ? { params: Promise.resolve(s.params) } : undefined);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const chunked = (text: string, size: number) => { const enc = new TextEncoder().encode(text); let i = 0; return new ReadableStream({ pull(c) { if (i >= enc.length) return c.close(); c.enqueue(enc.slice(i, i + size)); i += size; } }); };

for (const s of SPECS) {
  test(`${s.name}: over the cap by a DECLARED content-length is 413 "Request body too large"`, async () => {
    await world(); const mod = await loadModule(s.file);
    const r = await send(s, mod, '{"a":1}', { 'content-length': String(s.cap + 1) }); assert.equal(r.status, 413); assert.equal(r.body?.error, 'Request body too large');
  });
  test(`${s.name}: over the cap STREAMED (no content-length, 1 KB chunks) is 413`, async () => {
    await world(); const mod = await loadModule(s.file);
    const r = await send(s, mod, chunked(exactly(s.cap + 1), 1024), {}, true); assert.equal(r.status, 413, `status ${r.status}`);
  });
  test(`${s.name}: a body of EXACTLY ${s.cap} bytes is not refused for size, and one byte more is`, async () => {
    await world(); const mod = await loadModule(s.file);
    const at = await send(s, mod, exactly(s.cap)); assert.notEqual(at.status, 413, `the cap itself was refused (${JSON.stringify(at.body)})`);
    const over = await send(s, mod, exactly(s.cap + 1)); assert.equal(over.status, 413, 'cap + 1 byte');
  });
  test(`${s.name}: invalid JSON and an empty body are NOT a 413 (the route's own answer)`, async () => {
    await world(); const mod = await loadModule(s.file);
    for (const b of ['not json {', '']) { const r = await send(s, mod, b || null); assert.notEqual(r.status, 413, JSON.stringify(b)); assert.ok(r.status >= 400 && r.status < 500 || r.status === 200, `status ${r.status} for ${JSON.stringify(b)}`); }
  });
}

test('multi-byte text: the cap counts BYTES, not characters (a body of 2-byte characters just over the cap is 413 even though it has fewer characters)', async () => {
  await world(); const s = SPECS[1]; const mod = await loadModule(s.file);
  const head = '{"pad":"', tail = '"}'; const chars = Math.floor((s.cap - head.length - tail.length) / 2) + 1;
  const body = head + 'é'.repeat(chars) + tail; assert.ok(new TextEncoder().encode(body).length > s.cap && body.length < s.cap, 'the fixture is over in bytes and under in characters');
  assert.equal((await send(s, mod, body)).status, 413);
});
