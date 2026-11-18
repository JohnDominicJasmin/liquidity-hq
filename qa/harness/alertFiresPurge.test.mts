import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import path from 'node:path';

/* QA's BEHAVIOURAL run of #2585 POST /api/alert-fires/purge (PM decision 2026-11-18: keep 90 days; header secret only). The REAL handler in-process, an in-memory table (qa/harness/alertFiresPurgeStubs.mjs), Date.now frozen. Expectations come from the PR text and the tracker, not from running the route.
 *   U1  no x-cron-secret header: 401, NO delete issued
 *   U2  wrong secret (same length, shorter, longer, empty): 401, no delete
 *   U3  the secret ONLY in the query string (?secret=): 401, no delete
 *   U4  CRON_SECRET not configured: 401 for every caller, even one sending an empty/undefined secret, no delete (never an open endpoint)
 *   U5  right header: 200 { deleted, cutoff, retainDays: 90 }; the cutoff is exactly now - 90 days (UTC ISO)
 *   U6  boundary: a row 90 days minus 1 ms old is KEPT, 90 days plus 1 ms old is DELETED, a 91-day row deleted, a fresh row kept
 *   U7  the body is a count and the cutoff, never row data; only the table lhq_alert_fires is touched, only .delete().lt('fired_at')
 *   U8  GET / PUT / PATCH / DELETE are not exported (Next answers 405) and a GET with the right header deletes nothing
 *   U9  a failing delete is 502 and a throw is 500, with no upstream message in the body
 * Run from the repo root:  node --import ./qa/alias-register.mjs --test --test-force-exit qa/harness/alertFiresPurge.test.mts   (ROUTE_FILE=<path> points it at a mutated copy) */
const root = path.resolve('.');
const stubs = path.join(root, 'qa/harness/alertFiresPurgeStubs.mjs');
const routeFile = process.env.ROUTE_FILE ? path.resolve(process.env.ROUTE_FILE) : path.join(root, 'app/api/alert-fires/purge/route.ts');
const jiti = createJiti(import.meta.url, { alias: { '@/lib/supabase-admin': stubs, '@': root }, interopDefault: true, moduleCache: false });
type S = { rows: Array<{ id: number; fired_at: string }>; calls: Array<Record<string, unknown>>; mode: string };
const st = () => ((globalThis as unknown as { __purge: S }).__purge ??= { rows: [], calls: [], mode: 'ok' });
const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const DAY = 86_400_000;
const SECRET = 'qa-cron-secret-0123456789';
const realNow = Date.now;
type Route = { POST?: (r: Request) => Promise<Response>; GET?: unknown; PUT?: unknown; PATCH?: unknown; DELETE?: unknown };
async function load(): Promise<Route> { return (await jiti.import(routeFile)) as Route; }
function reset(rows: S['rows'] = []) { const s = st(); s.rows = rows.map((r) => ({ ...r })); s.calls = []; s.mode = 'ok'; Date.now = () => NOW; }
const post = (mod: Route, init: { header?: string; query?: string } = {}) => mod.POST!(new Request(`http://localhost/api/alert-fires/purge${init.query !== undefined ? `?secret=${encodeURIComponent(init.query)}` : ''}`, { method: 'POST', headers: init.header !== undefined ? { 'x-cron-secret': init.header } : {} }));
const iso = (ms: number) => new Date(ms).toISOString();
const ROWS = [
  { id: 1, fired_at: iso(NOW - 90 * DAY + 1) }, // 90d minus 1 ms old: keep
  { id: 2, fired_at: iso(NOW - 90 * DAY - 1) }, // 90d plus 1 ms old: delete
  { id: 3, fired_at: iso(NOW - 91 * DAY) },     // delete
  { id: 4, fired_at: iso(NOW - 1000) },         // keep
  { id: 5, fired_at: iso(NOW - 400 * DAY) },    // delete
];
afterEach(() => { Date.now = realNow; delete process.env.CRON_SECRET; });

test('U1. no header is 401 and nothing is deleted', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  const res = await post(mod); assert.equal(res.status, 401); assert.equal(st().calls.length, 0, 'a delete was issued without a secret'); assert.equal(st().rows.length, 5);
});
test('U2. a wrong secret (same length, shorter, longer, empty) is 401 and nothing is deleted', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  for (const bad of ['x'.repeat(SECRET.length), SECRET.slice(0, -1), SECRET + 'x', '', SECRET.toUpperCase()]) {
    const res = await post(mod, { header: bad }); assert.equal(res.status, 401, `secret ${JSON.stringify(bad)} got ${res.status}`);
  }
  assert.equal(st().calls.length, 0); assert.equal(st().rows.length, 5);
});
test('U3. the secret only in the query string is refused', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  const res = await post(mod, { query: SECRET }); assert.equal(res.status, 401, '?secret= was accepted: it travels into access logs'); assert.equal(st().calls.length, 0);
});
test('U4. with CRON_SECRET unset nobody gets in, including an empty secret', async () => {
  delete process.env.CRON_SECRET; reset(ROWS); const mod = await load();
  for (const init of [{}, { header: '' }, { header: 'undefined' }, { query: '' }, { header: SECRET }]) {
    const res = await post(mod, init); assert.equal(res.status, 401, `${JSON.stringify(init)} got ${res.status}`);
  }
  process.env.CRON_SECRET = ''; assert.equal((await post(mod, { header: '' })).status, 401, 'an EMPTY configured secret matched an empty header');
  assert.equal(st().calls.length, 0); assert.equal(st().rows.length, 5);
});
test('U5. the right header is 200 with {deleted, cutoff, retainDays: 90} and the cutoff is exactly now minus 90 days', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  const res = await post(mod, { header: SECRET }); assert.equal(res.status, 200); const body = await res.json();
  assert.equal(body.retainDays, 90); assert.equal(body.cutoff, iso(NOW - 90 * DAY)); assert.equal(body.deleted, 3);
  assert.equal(st().calls.length, 1); assert.equal(st().calls[0].val, iso(NOW - 90 * DAY));
});
test('U6. boundary: 90d - 1 ms is kept, 90d + 1 ms is deleted, fresh kept, old deleted', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  await post(mod, { header: SECRET }); assert.deepEqual(st().rows.map((r) => r.id).sort(), [1, 4], `kept ids: ${JSON.stringify(st().rows.map((r) => r.id))}`);
});
test('U7. the body is a count and a cutoff only; one delete on lhq_alert_fires by fired_at, no select', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  const res = await post(mod, { header: SECRET }); const body = await res.json(); assert.deepEqual(Object.keys(body).sort(), ['cutoff', 'deleted', 'retainDays']); assert.equal(typeof body.deleted, 'number');
  assert.equal(st().calls.length, 1); const c = st().calls[0]; assert.equal(c.table, 'lhq_alert_fires'); assert.equal(c.col, 'fired_at'); assert.equal(c.select, undefined);
  assert.doesNotMatch(JSON.stringify(body), /"id"|user|chat/i);
});
test('U8. only POST is exported (the rest are 405) and nothing is deleted by a GET', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  assert.equal(typeof mod.POST, 'function'); for (const m of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) assert.equal(mod[m], undefined, `${m} is exported`);
  assert.equal(st().calls.length, 0);
});
test('U9. a failing delete is 502 and a throw is 500, neither echoing the upstream message', async () => {
  process.env.CRON_SECRET = SECRET; reset(ROWS); const mod = await load();
  st().mode = 'error'; let res = await post(mod, { header: SECRET }); assert.equal(res.status, 502); assert.doesNotMatch(await res.text(), /secret-row-data|boom/);
  st().mode = 'throw'; res = await post(mod, { header: SECRET }); assert.equal(res.status, 500); assert.doesNotMatch(await res.text(), /network down/);
});
