/* #2740 live smoke (read-only GETs, signed out, nothing written or billed): the routes #2740 touched still answer HEALTHY on a deployed build. The failure paths (kill switch keeps the last known flags, rsi total outage, usage 503, last-good on upstream failure) are pinned by routeLastGood2740 / featureFlagsFailOpen2740 on the real handlers; this only proves the healthy shape did not move.
 *   S1 /api/config 200 with the flags object and no error   S2 /api/market/rsi 200 with a populated table and no `stale` flag   S3 /api/market/snapshot 200 without `stale`   S4 /api/cycle 200 without the X-Data-Stale header   S5 /api/macro 200
 * Prints each answer's status, size and the markers it checks. */
import { test, expect } from '@playwright/test';

const get = async (request: import('@playwright/test').APIRequestContext, path: string) => { const r = await request.get(path, { timeout: 90_000 }); const text = await r.text(); let json: unknown = null; try { json = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status(), headers: r.headers(), text, json }; };

test('S1 /api/config answers 200 with the flags and no error', async ({ request }) => {
  const r = await get(request, '/api/config'); const j = r.json as Record<string, unknown> | null;
  console.log(`[S2740] config: ${r.status} ${r.text.length} chars keys ${JSON.stringify(j ? Object.keys(j).slice(0, 12) : null)}`);
  expect(r.status).toBe(200); expect(j, 'config is not JSON').not.toBeNull(); expect(j && 'error' in j, 'config carries an error key').toBe(false);
});

test('S2 /api/market/rsi answers 200 with a populated table and no stale flag', async ({ request }) => {
  const r = await get(request, '/api/market/rsi'); const j = r.json as Record<string, unknown> | null;
  const coins = j && typeof j === 'object' ? Object.keys(((j as { rsi?: Record<string, unknown>; data?: Record<string, unknown> }).rsi ?? (j as { data?: Record<string, unknown> }).data ?? j) as Record<string, unknown>).length : 0;
  console.log(`[S2740] rsi: ${r.status} ${r.text.length} chars · entries ${coins} · stale ${JSON.stringify((j as { stale?: unknown } | null)?.stale)} · top keys ${JSON.stringify(j ? Object.keys(j).slice(0, 8) : null)}`);
  expect(r.status).toBe(200); expect(coins, 'the rsi table is empty').toBeGreaterThan(5); expect((j as { stale?: unknown } | null)?.stale, 'a healthy read is flagged stale').toBeFalsy();
});

test('S3 /api/market/snapshot answers 200 without stale', async ({ request }) => {
  const r = await get(request, '/api/market/snapshot'); const j = r.json as Record<string, unknown> | null;
  console.log(`[S2740] snapshot: ${r.status} ${r.text.length} chars · stale ${JSON.stringify((j as { stale?: unknown } | null)?.stale)} · keys ${JSON.stringify(j ? Object.keys(j).slice(0, 10) : null)}`);
  expect(r.status).toBe(200); expect((j as { stale?: unknown } | null)?.stale, 'a healthy snapshot is flagged stale').toBeFalsy();
});

test('S4/S5 /api/cycle and /api/macro answer 200; the healthy cycle carries no stale header', async ({ request }) => {
  const c = await get(request, '/api/cycle'); const m = await get(request, '/api/macro');
  console.log(`[S2740] cycle: ${c.status} ${c.text.length} chars x-data-stale ${JSON.stringify(c.headers['x-data-stale'] ?? null)} · macro: ${m.status} ${m.text.length} chars`);
  expect(c.status).toBe(200); expect(c.headers['x-data-stale'], 'a healthy cycle read carries the stale header').toBeUndefined(); expect(m.status).toBe(200);
});
