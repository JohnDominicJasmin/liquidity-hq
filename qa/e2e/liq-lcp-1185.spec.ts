/* #1185 /liq LCP PROBE (Dev's request 2026-11-23): at 390 px on slow 3G (400 kbit/s down, 200 up, 400 ms) log EVERY largest-contentful-paint entry (startTime, size, element tag and class, url, first 60 characters of its text), when every /api/* response finished (path, status, responseEnd), and when `.liq-range-row`, the first `.tpanel` and a bands block first appear. Signed out, read-only, GETs only. Prints [LIQLCP] lines; asserts only that the page answered. */
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>)');

test('LIQLCP /liq at 390 on slow 3G: every LCP candidate, the API finish times, and when the panels mount', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
    const w = window as unknown as { __p: { lcp: Array<Record<string, unknown>>; seen: Record<string, number> } };
    w.__p = { lcp: [], seen: {} };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as Array<{ startTime: number; size: number; element?: Element | null; url?: string; id?: string }>) {
          const el = e.element ?? null;
          w.__p.lcp.push({ t: Math.round(e.startTime), size: e.size, tag: el ? el.tagName.toLowerCase() : null, cls: el ? String((el as HTMLElement).className).slice(0, 60) : null, url: (e.url || '').slice(0, 80), text: el ? ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 60) : null });
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* none */ }
    const SEL: Record<string, string> = { liqRangeRow: '.liq-range-row', tpanel: '.tpanel', bands: '[class*="band" i]' };
    const tick = () => { for (const k of Object.keys(SEL)) if (w.__p.seen[k] == null && document.querySelector(SEL[k])) w.__p.seen[k] = Math.round(performance.now()); if (performance.now() < 70_000) setTimeout(tick, 100); };
    tick();
  });
  const page = await ctx.newPage();
  try {
    await page.goto('/api/version', { waitUntil: 'domcontentloaded' });
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) });
    const status = await page.goto('/liq', { waitUntil: 'commit', timeout: 60_000 }).then((r) => r?.status() ?? 0).catch(() => 0);
    await page.waitForTimeout(45_000);
    const r = await page.evaluate(() => {
      const w = window as unknown as { __p: { lcp: unknown[]; seen: Record<string, number> } };
      const api = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => /\/api\//.test(e.name)).map((e) => ({ path: e.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 90), start: Math.round(e.startTime), end: Math.round(e.responseEnd), size: e.transferSize, status: (e as unknown as { responseStatus?: number }).responseStatus ?? null })).sort((a, b) => a.end - b.end);
      return { lcp: w.__p.lcp, seen: w.__p.seen, api };
    });
    console.log(`[LIQLCP] navigation status ${status}`);
    for (const e of r.lcp) console.log(`[LIQLCP] LCP candidate ${JSON.stringify(e)}`);
    console.log(`[LIQLCP] first appearance (ms since navigation start) ${JSON.stringify(r.seen)}`);
    for (const a of r.api) console.log(`[LIQLCP] API ${JSON.stringify(a)}`);
    expect(status, 'the page did not answer').toBeGreaterThan(0);
  } finally { await ctx.close().catch(() => {}); }
});
