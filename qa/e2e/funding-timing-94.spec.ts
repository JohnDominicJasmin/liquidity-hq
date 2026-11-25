/* QA for PM's #94 on a DEPLOYED site, signed out, GETs only: how long the funding history and /funding take, cold cache key first. Prints [F94] lines. */
import { test } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test('F94 timings', async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    await installPaidAiFence(page);
    await page.goto('/api/version', { waitUntil: 'load', timeout: 150_000 });
    console.log(`[F94] ${new Date().toISOString()} version ${(await page.evaluate(() => document.body.innerText)).slice(0, 80)}`);
    for (const path of ['/api/market/funding-rate?limit=199', '/api/market/funding-rate?limit=199', '/api/market/funding-rate?limit=200', '/api/market/funding-rate?limit=200', '/api/market/snapshot']) {
      const m = await page.evaluate(async (p) => {
        performance.clearResourceTimings();
        const from = performance.now(); const r = await fetch(p, { cache: 'no-store' }); const body = await r.text(); const total = performance.now() - from;
        const e = performance.getEntriesByType('resource').filter((x) => x.name.includes(p.split('?')[0])).pop() as PerformanceResourceTiming | undefined;
        let j: Record<string, unknown> = {}; try { j = JSON.parse(body); } catch { /* not JSON */ }
        const size = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v);
        return { status: r.status, starttransfer: e ? Math.round(e.responseStart - e.startTime) : null, total: Math.round(total), bytes: body.length, ok: j.ok, count: j.total, stopped: j.stopped, viaFallback: size(j.viaFallback), data: size(j.data), keys: Object.keys(j).slice(0, 12) };
      }, path);
      console.log(`[F94] ${new Date().toISOString()} ${path}: ${JSON.stringify(m)}`);
    }
    const seen: string[] = []; const from = Date.now();
    page.on('response', (r) => { if (/funding-rate|bybit-tickers|\/api\/funding/.test(r.url())) seen.push(`${((Date.now() - from) / 1000).toFixed(1)}s ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}`); });
    const res = await page.goto('/funding', { waitUntil: 'load', timeout: 150_000 });
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; return { starttransfer: Math.round(n.responseStart), load: Math.round(n.loadEventEnd), total: Math.round(n.responseEnd) }; });
    await page.locator('.frh-table tbody tr').first().waitFor({ state: 'visible', timeout: 150_000 }).catch(() => {});
    console.log(`[F94] /funding: status=${res?.status()} ${JSON.stringify(nav)} firstRow=${((Date.now() - from) / 1000).toFixed(1)}s`);
    await page.waitForTimeout(10_000);
    console.log(`[F94] /funding reads: ${seen.join(' | ')}`);
  } finally { await ctx.close().catch(() => {}); }
});
