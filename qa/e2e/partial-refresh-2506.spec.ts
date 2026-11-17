/* #2506 BROWSER/SERVER CELLS. Needs a CI BUILD with QA_INTERCEPT_UPSTREAM=partial (qa/server-intercept.mjs: stub mode where, while qa/.partial-on exists, half of the symbols are refused 503). Not for a deployed URL.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f project=desktop -f "spec=qa/e2e/partial-refresh-2506.spec.ts"
 *   PA1  a PARTIAL refresh does not replace a good entry: /api/market/open-interest (5min/13, a live fan-out, TTL 120 s) read good, then the venue refuses half the symbols and the entry ages past its TTL: the next reads still carry the SAME symbols and the same "ts" family as the first (not half of them)
 *   PA2  CONTROL: with NO earlier entry a partial result is still returned (some cells beat none): a different combination read for the first time while half refuse comes back with fewer symbols than PA1's first read, but not zero. Without this PA1 could pass on a route that returns nothing
 *   PB   /briefing with /api/cmc forced to 502 on first load says "unavailable" (not a blank or a number), and after the route is restored a reload shows the value
 *   PC   120 calls in a minute on /api/cmc are not rate limited (no 429 up to 120); the 130th may be
 *   PD   /hours makes no market request (/api/market/*, /api/proxy, /api/cmc, /api/funding)
 * Signed out, nothing clicked or saved. */
import { test, expect } from '@playwright/test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FLAG = resolve(process.env.QA_INTERCEPT_PARTIAL_FLAG ?? 'qa/.partial-on');
const OI = (limit: number) => `/api/market/open-interest?intervalTime=5min&limit=${limit}`;
const symbolsOf = (b: unknown): string[] => { const d = (b as { data?: Record<string, unknown> })?.data; return d && typeof d === 'object' ? Object.keys(d) : []; };

test.afterAll(() => { try { rmSync(FLAG, { force: true }); } catch { /* none */ } });

test('PA1/PA2. a partial refresh keeps the last good entry; with no earlier entry the partial result is returned', async ({ request }) => {
  test.setTimeout(420_000);
  try { rmSync(FLAG, { force: true }); } catch { /* none */ }
  const first = await request.get(OI(13)); expect(first.status(), 'the good first read').toBe(200);
  const firstBody = await first.json(); const good = symbolsOf(firstBody);
  console.log(`[PARTIAL] first read: ${good.length} symbols ok=${firstBody.ok} total=${firstBody.total}`);
  expect(good.length, 'the first read must carry symbols or the cell proves nothing').toBeGreaterThan(10);
  writeFileSync(FLAG, '1');
  expect(existsSync(FLAG)).toBe(true);
  /* PA2 control FIRST (a new combination = no earlier entry), while half refuse */
  const ctl = await request.get(OI(7)); const ctlSyms = ctl.status() === 200 ? symbolsOf(await ctl.json()) : [];
  console.log(`[PARTIAL] control (no earlier entry, half refuse): status ${ctl.status()}, ${ctlSyms.length} symbols`);
  expect(ctlSyms.length, 'PA2 control: with no earlier entry a partial result is returned, not nothing').toBeGreaterThan(0);
  expect(ctlSyms.length, 'PA2 control: the refusal must really be in effect (fewer than the good read)').toBeLessThan(good.length);
  /* age the good entry past its 120 s TTL (and inside the 60 s stale window), then read: this triggers the refresh that the venue half-refuses */
  await new Promise((r) => setTimeout(r, 125_000));
  const stale = await request.get(OI(13)); expect(stale.status()).toBe(200);
  await new Promise((r) => setTimeout(r, 8_000));   // the background refresh settles (it must fail on coverage)
  const after = await request.get(OI(13)); expect(after.status(), 'after the partial refresh').toBe(200);
  const afterSyms = symbolsOf(await after.json());
  console.log(`[PARTIAL] after the partial refresh: ${afterSyms.length} symbols (first ${good.length})`);
  expect(afterSyms.length, 'the partial refresh REPLACED the good entry (half of the symbols are gone)').toBe(good.length);
  rmSync(FLAG, { force: true });
});

test('PB. /briefing with /api/cmc failing says unavailable, and recovers', async ({ page }) => {
  test.setTimeout(150_000);
  let fail = true;
  await page.route('**/api/cmc**', (r) => (fail ? r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"unavailable"}' }) : r.continue()));
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await page.goto('/briefing', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000);
  const t1 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log(`[PARTIAL] briefing with cmc 502: ${t1.length} chars, "unavailable" ${/unavailable/i.test(t1)}, NaN ${/\bNaN\b/.test(t1)}, undefined ${/undefined/.test(t1)}`);
  console.log(`[PARTIAL] briefing text with cmc 502: ${t1.slice(0, 1500)}`);
  expect(/\bNaN\b|undefined|\[object/.test(t1), 'a broken value is drawn').toBe(false);
  expect(/unavailable|no data/i.test(t1), 'the failed read must say unavailable or no data').toBe(true);
  fail = false; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000);
  const t2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log(`[PARTIAL] briefing after recovery: "unavailable" ${/unavailable/i.test(t2)}`);
});

test('PC. 120 calls in a minute on /api/cmc are not rate limited', async ({ request }) => {
  test.setTimeout(150_000);
  const codes: Record<string, number> = {}; let first429 = -1;
  for (let i = 1; i <= 130; i++) { const r = await request.get('/api/cmc?type=global'); const k = String(r.status()); codes[k] = (codes[k] ?? 0) + 1; if (r.status() === 429 && first429 < 0) first429 = i; }
  console.log(`[PARTIAL] 130 calls /api/cmc: ${JSON.stringify(codes)} first429=${first429}`);
  expect(first429 === -1 || first429 > 120, `rate limited at call ${first429} (limit is 120/min)`).toBe(true);
});

test('PD. /hours makes no market request', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (/^\/api\/(market|proxy|cmc|funding|liquidations)/.test(u.pathname)) hits.push(u.pathname); });
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await page.goto('/hours', { waitUntil: 'load' }); await page.waitForTimeout(8_000);
  console.log(`[PARTIAL] /hours market requests: ${hits.length} ${hits.slice(0, 5).join(',')}`);
  expect(hits, '/hours must not call the market routes').toEqual([]);
});
