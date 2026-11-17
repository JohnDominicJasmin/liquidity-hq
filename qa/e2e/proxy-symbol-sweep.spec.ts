/* PROXY SYMBOL SWEEP: the gate for the hardening change that makes /api/proxy refuse any symbol the app does not track (#2503: "anything else is a 400 and is not cached").
 * The risk it carries is a LEGITIMATE symbol the app really sends being refused, so every page that calls the proxy with a symbol is loaded and every /api/proxy answer is recorded.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=https://liquidity-hq-staging.onrender.com -f project=desktop -f spec=qa/e2e/proxy-symbol-sweep.spec.ts
 *   X1  the nine pages (Dashboard, Markets, Funding, Liquidations, Arena, Briefing, Research, Scanner, Correlation) signed out and as Pro, at 1280: one [PROXY] line per page with the number of proxy calls, the statuses seen, and every 400 with its URL; the cell FAILS on any 400 from /api/proxy
 *   X2  /arena for EVERY tracked coin (the app's own list, lib/coins.ts COINS) signed out: the page asks the proxy for that coin's symbols; any 400 fails the cell and names the coin and the URL
 *   X3  CONTROL: a symbol the app does not track IS refused with 400 (so the sweep above can fail), and a tracked one is not
 * An upstream 5xx (a venue refusing the runner) is NOT a 400 and is reported, not failed. Paid-AI fence on, nothing is clicked or saved. */
import { test, expect, type Page } from '@playwright/test';
import { COINS } from '../../lib/coins';
import { AUTH_READY, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { gotoGuarded } from './_shared';

const PAGES = ['/dashboard', '/markets', '/funding', '/liq', '/arena', '/briefing', '/research', '/scanner', '/correlation'] as const;
const PROD = process.env.E2E_ALLOW_PRODUCTION === '1';

type Seen = { url: string; status: number };
function watchProxy(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on('response', (r) => { try { const u = new URL(r.url()); if (u.pathname.startsWith('/api/proxy')) seen.push({ url: `${u.pathname}${u.search}`.slice(0, 220), status: r.status() }); } catch { /* ignore */ } });
  return seen;
}
const summary = (seen: Seen[]) => { const by: Record<string, number> = {}; for (const s of seen) by[String(s.status)] = (by[String(s.status)] ?? 0) + 1; return by; };

for (const persona of ['out', 'pro'] as const) for (const path of PAGES) {
  test(`X1:${persona}:${path}`, async ({ browser }) => {
    test.skip(persona === 'pro' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000);
    const ctx = persona === 'out' ? await browser.newContext({ viewport: { width: 1280, height: 900 } }) : await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); await installPaidAiFence(page); const seen = watchProxy(page);
    try {
      await gotoGuarded(page, path, { waitUntil: 'domcontentloaded', timeout: 60_000 } as never); await page.waitForTimeout(20_000);
      const bad = seen.filter((s) => s.status === 400);
      console.log(`[PROXY] ${JSON.stringify({ persona, path, calls: seen.length, statuses: summary(seen), badRequests: bad.slice(0, 6) })}`);
      expect(bad, `/api/proxy answered 400 on ${path} (${persona}): ${JSON.stringify(bad.slice(0, 4))}`).toEqual([]);
    } finally { await ctx.close(); }
  });
}

for (const coin of COINS as readonly string[]) {
  test(`X2:/arena?coin=${coin}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page); const seen = watchProxy(page);
    try {
      await gotoGuarded(page, `/arena?coin=${coin}&tf=1h`, { waitUntil: 'domcontentloaded', timeout: 60_000 } as never); await page.waitForTimeout(12_000);
      const bad = seen.filter((s) => s.status === 400);
      console.log(`[PROXY] ${JSON.stringify({ coin, calls: seen.length, statuses: summary(seen), badRequests: bad.slice(0, 4) })}`);
      expect(bad, `/api/proxy answered 400 for the tracked coin ${coin}: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
    } finally { await ctx.close(); }
  });
}

test('X3:control: an untracked symbol is refused with 400, a tracked one is not', async ({ request }) => {
  const untracked = await request.get('/api/proxy?type=binance-ticker&symbol=NOTACOINUSDT', { failOnStatusCode: false });
  const tracked = await request.get('/api/proxy?type=binance-24hr&symbols=%5B%22BTCUSDT%22%5D', { failOnStatusCode: false });
  console.log(`[PROXY] ${JSON.stringify({ control: true, untrackedStatus: untracked.status(), trackedStatus: tracked.status() })}`);
  expect(tracked.status(), 'a tracked symbol was refused with 400').not.toBe(400);
  expect([400, 404, 502], 'an untracked symbol must be refused (400 once the hardening is deployed)').toContain(untracked.status());
});
