/* #2555: buildLsr now THROWS when no futures host is reachable (it used to return {}). The snapshot must still answer 200 with the ticker and the klines, and name `lsr` in `partial`; a rejected section must not take the others down.
 * API cell, signed out, GET only (read-only on production too). CONTROL INSIDE: it only proves the change when lsr really is empty in this environment (Binance futures unreachable from the host under test: true on CI-built refs and on staging); if lsr is present the test says so and fails with "NOT EXERCISED" rather than passing silently. Run it twice, 70 s apart, so the second call is served from the section caches (a thrown section must not poison them). */
import { test, expect } from '@playwright/test';

test('LS1. /api/market/snapshot answers 200 with ticker + klines while lsr is unavailable, on a cold call and a cached one', async ({ request }) => {
  test.setTimeout(240_000);
  const read = async () => { const r = await request.get('/api/market/snapshot', { timeout: 90_000 }); const j = r.ok() ? await r.json() : null; return { status: r.status(), j }; };
  const a = await read(); const sum = (x: typeof a) => x.j ? { t: Object.keys(x.j.ticker ?? {}).length, k: Object.keys(x.j.klines ?? {}).length, l: Object.keys(x.j.lsr ?? {}).length, partial: x.j.partial } : null;
  console.log(`[LSR] cold ${a.status} ${JSON.stringify(sum(a))}`);
  expect(a.status, 'the snapshot did not answer 200').toBe(200);
  expect(sum(a)!.t, 'ticker is empty').toBeGreaterThan(0); expect(sum(a)!.k, 'klines is empty').toBeGreaterThan(0);
  expect(sum(a)!.l, 'NOT EXERCISED: lsr is present in this environment, so a rejected lsr was never produced').toBe(0);
  expect(sum(a)!.partial, 'lsr is not named in partial').toContain('lsr');
  await new Promise((r) => setTimeout(r, 70_000)); const b = await read(); console.log(`[LSR] cached ${b.status} ${JSON.stringify(sum(b))}`);
  expect(b.status).toBe(200); expect(sum(b)!.t).toBeGreaterThan(0); expect(sum(b)!.k).toBeGreaterThan(0); expect(sum(b)!.partial).toContain('lsr');
});
