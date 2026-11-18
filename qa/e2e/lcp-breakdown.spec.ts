/* LCP BREAKDOWN (PM: "I need to know WHAT element is LCP at 11.4 s on /about, and where the time goes"). Signed out, read only, nothing clicked.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<url> -f project=desktop -f spec=qa/e2e/lcp-breakdown.spec.ts
 *   LB:<path>:<net>   /about, /faq and / at 390 px, on a slow 3G link (CDP: 400 kbps down, 200 kbps up, 400 ms RTT) and on the normal runner network for comparison
 * One [LCP] JSON line per cell:
 *   lcp         every LCP candidate the browser reported, in order: time, the ELEMENT (tag, first class, id, first 40 characters of its text, image url) and its size, so the last one is the answer and the earlier ones show what it replaced
 *   timeline    TTFB (responseStart), HTML done (responseEnd), DOMContentLoaded, load, first paint, first contentful paint, and LCP, all from navigation start
 *   blocking    render-blocking stylesheets (renderBlockingStatus = blocking): name, size on the wire, and when each finished; the time the LAST one finished is the earliest the page can paint
 *   fonts       font files (woff / woff2): name, size, when each finished; and when document.fonts.ready resolved; font-display of the loaded faces
 *   heaviest    the 8 largest transfers and every resource that finished AFTER the first contentful paint, so a late script or image is visible
 *   totals      number of requests and bytes on the wire by type
 * Informational: it never fails on a number. */
import { test, type Page } from '@playwright/test';

const PAGES = ['/about', '/faq', '/'] as const;

async function arm(page: Page, slow: boolean) {
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: unknown[]; __fontsReady?: number };
    w.__lcp = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ startTime: number; size: number; url: string; id: string; element: Element | null }>) { const el = e.element; w.__lcp.push({ t: Math.round(e.startTime), tag: el?.tagName?.toLowerCase() ?? '(removed)', cls: typeof (el as HTMLElement | null)?.className === 'string' ? String((el as HTMLElement).className).split(' ')[0] : '', id: e.id || el?.id || '', text: ((el as HTMLElement | null)?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), url: (e.url || '').slice(0, 80), size: e.size }); } }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported */ }
    try { (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => { w.__fontsReady = Math.round(performance.now()); }); } catch { /* ignore */ }
  });
  if (slow) { const c = await page.context().newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) }); }
}

async function measureDoc(page: Page) {
  return page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
        const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const short = (n: string) => { try { const u = new URL(n); return (u.pathname.split('/').pop() || u.pathname).slice(0, 44) + (u.host !== location.host ? ` @${u.host}` : ''); } catch { return n.slice(0, 44); } };
        const row = (x: PerformanceResourceTiming) => ({ name: short(x.name), type: x.initiatorType, kb: Math.round((x.transferSize || x.encodedBodySize || 0) / 102.4) / 10, doneAt: Math.round(x.responseEnd) });
        const blocking = res.filter((x) => (x as unknown as { renderBlockingStatus?: string }).renderBlockingStatus === 'blocking').map(row);
        const fonts = res.filter((x) => /\.(woff2?|ttf|otf)(\?|$)/i.test(x.name)).map(row);
        const fcp = paint['first-contentful-paint'] ?? 0;
        const late = res.filter((x) => x.responseEnd > fcp).sort((a, b) => b.responseEnd - a.responseEnd).slice(0, 8).map(row);
        const heaviest = [...res].sort((a, b) => (b.transferSize || b.encodedBodySize || 0) - (a.transferSize || a.encodedBodySize || 0)).slice(0, 8).map(row);
        const byType: Record<string, { n: number; kb: number }> = {};
        for (const x of res) { const k = x.initiatorType || 'other'; byType[k] = byType[k] ?? { n: 0, kb: 0 }; byType[k].n++; byType[k].kb += Math.round((x.transferSize || x.encodedBodySize || 0) / 102.4) / 10; }
        const faces = Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 8);
        const w = window as unknown as { __lcp: unknown[]; __fontsReady?: number };
        return { lcp: w.__lcp, timeline: { ttfb: Math.round(nav?.responseStart ?? 0), htmlDone: Math.round(nav?.responseEnd ?? 0), dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0), load: Math.round(nav?.loadEventEnd ?? 0), fp: paint['first-paint'] ?? null, fcp: paint['first-contentful-paint'] ?? null, fontsReadyAt: w.__fontsReady ?? null, htmlKB: Math.round((nav?.transferSize ?? 0) / 102.4) / 10 }, blocking, lastBlockingDoneAt: blocking.length ? Math.max(...blocking.map((b) => b.doneAt)) : null, fonts, lastFontDoneAt: fonts.length ? Math.max(...fonts.map((b) => b.doneAt)) : null, faces, heaviest, finishedAfterFCP: late, totals: { requests: res.length, kb: Math.round(Object.values(byType).reduce((a, b) => a + b.kb, 0)), byType } };
      });
}

for (const path of PAGES) for (const net of ['slow', 'normal'] as const) {
  const title = `LB:${path}:${net}`;
  test(title, async ({ browser }) => {
    test.setTimeout(net === 'slow' ? 240_000 : 90_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await arm(page, net === 'slow');
    try {
      await page.goto(path, { waitUntil: 'load', timeout: 180_000 }).catch(() => {});
      await page.waitForTimeout(net === 'slow' ? 12_000 : 5_000);   // late LCP candidates and the font swap land after load
      const r = await measureDoc(page);
      const last = (r.lcp as Array<{ t: number }>).slice(-1)[0];
      console.log(`[LCP] ${JSON.stringify({ title, lcpFinal: last ?? null, ...r })}`);
    } finally { await ctx.close(); }
  });
}

/* REPEAT VISIT COST: /about, then a full navigation to /faq in the SAME context (warm HTTP cache). The second document's LCP, timeline and what came from cache (transferSize 0) are reported, so the cost of the second page is separate from the first. */
for (const net of ['slow', 'normal'] as const) {
  const title = `LB2:/about>/faq:${net}`;
  test(title, async ({ browser }) => {
    test.setTimeout(net === 'slow' ? 360_000 : 120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await arm(page, net === 'slow');
    try {
      await page.goto('/about', { waitUntil: 'load', timeout: 180_000 }).catch(() => {}); await page.waitForTimeout(net === 'slow' ? 12_000 : 5_000);
      const first = await measureDoc(page);
      const t0 = Date.now(); await page.goto('/faq', { waitUntil: 'load', timeout: 180_000 }).catch(() => {}); const loadMs = Date.now() - t0; await page.waitForTimeout(net === 'slow' ? 12_000 : 5_000);
      const second = await measureDoc(page);
      const cached = await page.evaluate(() => { const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]; return { requests: res.length, fromCache: res.filter((x) => x.transferSize === 0 && x.decodedBodySize > 0).length, kbOnWire: Math.round(res.reduce((a, x) => a + (x.transferSize || 0), 0) / 102.4) / 10 }; });
      const lf = (first.lcp as Array<{ t: number }>).slice(-1)[0], ls = (second.lcp as Array<{ t: number }>).slice(-1)[0];
      console.log(`[LCP] ${JSON.stringify({ title, firstDocLcp: lf ?? null, firstTimeline: first.timeline, secondDocLcp: ls ?? null, secondTimeline: second.timeline, secondNavigationLoadMs: loadMs, secondDocCache: cached, secondBlocking: second.blocking, secondLastBlockingDoneAt: second.lastBlockingDoneAt, secondTotals: second.totals })}`);
    } finally { await ctx.close(); }
  });
}

/* CLIENT-SIDE NAVIGATION (what a real visitor does: click a link, no full document load). /about, then a click on the page's own link to /faq, and back: bytes on the wire and requests that started after the click (RSC payloads, chunks), and the time from the click until the new page's heading is on screen. */
for (const net of ['slow', 'normal'] as const) {
  const title = `LB3:/about>click>/faq>click>/about:${net}`;
  test(title, async ({ browser }) => {
    test.setTimeout(net === 'slow' ? 360_000 : 240_000); /* QA 2026-11-18: the :normal twin hit the 120 s budget on every CI build of the release (it holds a 30 s idle wait) */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await arm(page, net === 'slow');
    const hop = async (href: string, heading: RegExp) => {
      const t0 = await page.evaluate(() => performance.now());
      await page.locator(`a[href="${href}"]`).first().scrollIntoViewIfNeeded().catch(() => {});
      const clicked = await page.locator(`a[href="${href}"]`).first().click({ timeout: 20_000 }).then(() => true).catch(() => false);
      const w0 = Date.now(); const seen = await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 120_000 }).then(() => true).catch(() => false); const ms = Date.now() - w0;
      await page.waitForTimeout(net === 'slow' ? 8_000 : 2_000);
      const after = await page.evaluate((t) => { const res = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((x) => x.startTime >= t); const kb = Math.round(res.reduce((a, x) => a + (x.transferSize || 0), 0) / 102.4) / 10; const byType: Record<string, number> = {}; for (const x of res) byType[x.initiatorType || 'other'] = (byType[x.initiatorType || 'other'] ?? 0) + 1; return { requests: res.length, kbOnWire: kb, byType, docEntries: performance.getEntriesByType('navigation').length }; }, t0);
      return { href, clicked, headingSeen: seen, clickToHeadingMs: ms, ...after, fullDocumentLoad: await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? '') };
    };
    try {
      await page.goto('/about', { waitUntil: 'load', timeout: 180_000 }).catch(() => {}); await page.waitForTimeout(net === 'slow' ? 12_000 : 5_000);
      const first = await measureDoc(page);
      const a = await hop('/faq', /frequently asked/i); const b = await hop('/about', /about|crypto|liquidity/i);
      console.log(`[LCP] ${JSON.stringify({ title, firstLoadHtmlKB: first.timeline.htmlKB, hops: [a, b] })}`);
    } finally { await ctx.close(); }
  });
}
