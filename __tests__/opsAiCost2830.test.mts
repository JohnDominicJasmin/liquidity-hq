/* QA: PR #2830 (#1413 owner item 81). The admin AI-cost route shows RECORDED cost. The real route and admin gate run; Supabase is a stand-in.
 *   C1 site totals are the three database sums (24 h, 7 d, 30 d), each asked for its own window, with null costs counted at the estimates
 *   C2 per-user spend is the call log's recorded cost by rolling window; a call with no cost counts at the estimate (search and other differ); a scheduled job's call is in nobody's row
 *   C3 a call log longer than the read bound sets truncated; a short one does not
 *   C4 each failed read answers 500: never $0 spend, never every account shown as Free */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NULL_COST_OTHER_ESTIMATE_USD, NULL_COST_SEARCH_ESTIMATE_USD } from '../lib/aiSpendCap';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
delete process.env.ADMIN_EMAILS; delete process.env.OPS_SECOND_FACTOR_OFF;
const DAY = 86_400_000;
const ADMIN = '77777777-7777-4777-8777-777777777777', U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Row = { id: number; user_id: string | null; call_type: string; cost_usd: number | null; created_at: string };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const world = { calls: [] as Row[], fail: '' as string, sums: [] as number[] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin !== SUPABASE) throw new Error(`stray request ${req.url}`);
  if (url.pathname === '/auth/v1/user') return json(200, { id: ADMIN, email: 'qa-admin@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', aud: 'authenticated', role: 'authenticated' });
  if (url.pathname.startsWith('/auth/v1/admin/users/')) { const id = url.pathname.split('/').pop()!; return json(200, { id, email: `${id.slice(0, 4)}@example.test`, aud: 'authenticated' }); }
  const table = url.pathname.replace('/rest/v1/', '');
  const down = () => json(500, { code: 'XX000', message: `stand-in: ${table} down`, details: '', hint: '' });
  if (table === 'rpc/lhq_ai_spend_all_since') {
    const since = (await req.json() as { p_since: string }).p_since;
    const days = Math.round((Date.now() - Date.parse(since)) / DAY);
    world.sums.push(days);
    if (world.fail === `sum${days}`) return down();
    return json(200, [{ cost: String(days), null_search: 1, null_other: 2 }]);
  }
  if (world.fail && table.endsWith(world.fail)) return down();
  if (table.endsWith('admin_users')) { const rows = [{ role: 'owner', active: true }]; return json(200, (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? rows[0] : rows); }
  if (table.endsWith('global_ai_usage')) return json(200, []);
  const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000);
  if (table.endsWith('ai_call_log')) return json(200, world.calls.slice(offset, offset + Math.min(limit, 1000)));
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { world.calls = []; world.fail = ''; world.sums = []; });

const { GET } = await import('../app/api/ops/ai-cost/route') as { GET: (r: Request) => Promise<Response> };
const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${part({ alg: 'ES256' })}.${part({ sub: ADMIN, aal: 'aal2' })}.sig`;
type Body = { cost: { global24h: number; global7d: number; global30d: number }; topSpenders: Array<{ userId: string; cost24h: number; cost7d: number; cost30d: number; role: string }>; truncated: boolean; error?: string };
const call = async () => { const r = await GET(new Request('http://localhost/api/ops/ai-cost', { headers: { Authorization: `Bearer ${token}` } })); return { status: r.status, body: await r.json() as Body }; };
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a}, wanted ${b}`);

test('C1. site totals are the database sums for 24 h, 7 d and 30 d', async () => {
  const r = await call();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([...world.sums].sort((a, b) => a - b), [1, 7, 30]);
  const extra = NULL_COST_SEARCH_ESTIMATE_USD + 2 * NULL_COST_OTHER_ESTIMATE_USD;
  near(r.body.cost.global24h, 1 + extra, '24h'); near(r.body.cost.global7d, 7 + extra, '7d'); near(r.body.cost.global30d, 30 + extra, '30d');
});

test('C2. per-user spend is the recorded cost by rolling window', async () => {
  const row = (id: number, user_id: string | null, call_type: string, cost_usd: number | null, age: number): Row => ({ id, user_id, call_type, cost_usd, created_at: ago(age) });
  world.calls = [row(1, U1, 'quick', 0.5, DAY / 2), row(2, U1, 'chat_search', null, 3 * DAY), row(3, U1, 'deep', null, 20 * DAY), row(4, U2, 'deep', 0.25, 25 * DAY), row(5, null, 'cron', 99, DAY / 2)];
  const r = await call();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.topSpenders.map((s) => s.userId), [U1, U2], 'a row with no user is in somebody\'s total');
  const [a, b] = r.body.topSpenders;
  near(a.cost24h, 0.5, 'U1 24h'); near(a.cost7d, 0.5 + NULL_COST_SEARCH_ESTIMATE_USD, 'U1 7d'); near(a.cost30d, 0.5 + NULL_COST_SEARCH_ESTIMATE_USD + NULL_COST_OTHER_ESTIMATE_USD, 'U1 30d');
  near(b.cost24h, 0, 'U2 24h'); near(b.cost30d, 0.25, 'U2 30d');
  assert.equal(r.body.truncated, false);
});

test('C3. a call log past the read bound says so', async () => {
  world.calls = Array.from({ length: 10_001 }, (_, i) => ({ id: i + 1, user_id: U1, call_type: 'quick', cost_usd: 0.001, created_at: ago(DAY / 2) }));
  const r = await call();
  assert.equal(r.status, 200); assert.equal(r.body.truncated, true);
});

test('C4. each failed read is a 500', async () => {
  for (const fail of ['grok_usage', 'user_subscriptions', 'ai_call_log', 'sum1', 'sum7', 'sum30']) {
    world.fail = fail;
    const r = await call();
    assert.equal(r.status, 500, `${fail}: answered ${r.status}`);
    assert.equal('cost' in r.body, false, fail);
  }
});
