/* FIRST LOAD (the speed change: analytics and error reporting after load + idle, the AI chat and the strategy registry out of every route's first load). Signed out, nothing is bought or saved; the error tracker is INTERCEPTED so no forced error reaches it.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f spec=qa/e2e/speed-first-load.spec.ts      (no base_url = CI builds the ref)
 *   SP:<path>:<net>     /about, /faq and / at 390 px, a COLD load (empty cache) on slow 3G (CDP: 400 kbps down, 200 kbps up, 400 ms RTT) and on the normal runner network:
 *                       first-load KB by type up to the load event and in total; every script that finished BEFORE load tagged by what it contains (PostHog, error reporting, the strategy registry, the AI chat); LCP element and time; FCP; TTFB
 *   SP:chat-button      the AI chat button APPEARS after the page (waited for, up to 30 s), opens the chat panel on a tap, and the panel carries its quick-question row
 *   SP:consent          with no stored choice the consent banner shows; Decline hides it and PostHog is never requested; (Accept is not pressed: no analytics call is made from this run)
 *   SP:early-error      an error thrown in the first milliseconds (before any script of the app runs) still reaches the error tracker: the envelope is captured at the network layer (and answered locally) and must carry the marker text
 * Informational numbers, plus three assertions (no PostHog / error-reporting / registry / chat code in the first load; the chat button opens; the early error arrives). */
import { test, expect, type Page } from '@playwright/test';

const PAGES = ['/about', '/faq', '/'] as const;
const TRACKER = /(glitchtip|sentry|\/envelope|\/api\/\d+\/(store|envelope))/i;

async function slow(page: Page) { const c = await page.context().newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) }); }

for (const path of PAGES) for (const net of ['slow', 'normal'] as const) {
  const title = `SP:${path}:${net}`;
  test(title, async ({ browser }) => {
    test.setTimeout(net === 'slow' ? 300_000 : 120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      const w = window as unknown as { __lcp: unknown[] }; w.__lcp = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ startTime: number; size: number; url: string; element: Element | null }>) { const el = e.element; w.__lcp.push({ t: Math.round(e.startTime), tag: el?.tagName?.toLowerCase() ?? '(removed)', cls: typeof (el as HTMLElement | null)?.className === 'string' ? String((el as HTMLElement).className).split(' ')[0] : '', text: ((el as HTMLElement | null)?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40), url: (e.url || '').slice(0, 60), size: e.size }); } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
    });
    const page = await ctx.newPage(); if (net === 'slow') await slow(page);
    try {
      await page.goto(path, { waitUntil: 'load', timeout: 240_000 }).catch(() => {}); await page.waitForTimeout(net === 'slow' ? 10_000 : 4_000);
      const r = await page.evaluate(async () => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; const loadAt = nav?.loadEventStart || nav?.loadEventEnd || 0;
        const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
        const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const kb = (x: PerformanceResourceTiming) => (x.transferSize || x.encodedBodySize || 0) / 1024;
        const before = res.filter((x) => x.responseEnd <= loadAt + 5);
        const byType = (list: PerformanceResourceTiming[]) => { const o: Record<string, { n: number; kb: number }> = {}; for (const x of list) { const k = /\.js(\?|$)/.test(x.name) ? 'script' : /\.css(\?|$)/.test(x.name) ? 'css' : /\.(woff2?|ttf|otf)(\?|$)/.test(x.name) ? 'font' : /\.(png|jpe?g|webp|avif|gif|svg|ico)(\?|$)/.test(x.name) ? 'image' : (x.initiatorType || 'other'); o[k] = o[k] ?? { n: 0, kb: 0 }; o[k].n++; o[k].kb = Math.round((o[k].kb + kb(x)) * 10) / 10; } return o; };
        const scripts = before.filter((x) => /\.js(\?|$)/.test(x.name));
        const tagged: Array<{ name: string; kb: number; doneAt: number; has: string[] }> = [];
        for (const s of scripts) { let text = ''; try { text = await (await fetch(s.name, { cache: 'force-cache' })).text(); } catch { /* cross-origin or evicted */ } const has: string[] = []; if (/posthog/i.test(text) || /posthog/i.test(s.name)) has.push('posthog'); if (/@sentry|sentry\.io|Sentry\b/.test(text) || /sentry|glitchtip/i.test(s.name)) has.push('error-reporting'); if (/paramSchema/.test(text)) has.push('strategy-registry'); if (/gchat-quick-row|gchat-/.test(text)) has.push('ai-chat'); if (has.length) tagged.push({ name: (s.name.split('/').pop() || s.name).slice(0, 44), kb: Math.round(kb(s) * 10) / 10, doneAt: Math.round(s.responseEnd), has }); }
        const hosts = Array.from(new Set(before.map((x) => { try { return new URL(x.name).host; } catch { return ''; } }).filter((h) => h && h !== location.host)));
        const w = window as unknown as { __lcp: Array<{ t: number }> };
        return { ttfb: Math.round(nav?.responseStart ?? 0), fcp: paint['first-contentful-paint'] ?? null, loadAt: Math.round(loadAt), lcp: w.__lcp.slice(-1)[0] ?? null, firstLoad: { requests: before.length, kb: Math.round(before.reduce((a, x) => a + kb(x), 0)), byType: byType(before) }, total: { requests: res.length, kb: Math.round(res.reduce((a, x) => a + kb(x), 0)), byType: byType(res) }, tagged, thirdPartyHostsBeforeLoad: hosts };
      });
      console.log(`[SPEED] ${JSON.stringify({ title, ...r })}`);
      const bad = r.tagged.filter((t) => t.has.some((h) => ['posthog', 'error-reporting', 'strategy-registry', 'ai-chat'].includes(h)));
      expect(bad, `code that must not be in the first load arrived before the load event on ${path} (${net}): ${JSON.stringify(bad)}`).toEqual([]);
    } finally { await ctx.close(); }
  });
}

test('SP:chat-button', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    const t0 = Date.now(); await page.goto('/about', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const btn = page.locator('button, a').filter({ hasText: /ask (ai|liquidityai)|✦/i }).or(page.locator('[aria-label*="chat" i], [aria-label*="ask" i]')).first();
    await btn.waitFor({ state: 'visible', timeout: 30_000 }); const appearedAfter = Date.now() - t0;
    await btn.click(); const row = page.locator('.gchat-quick-row, [class*=gchat]').first(); await row.waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`[SPEED] ${JSON.stringify({ title: 'SP:chat-button', buttonVisibleAfterMs: appearedAfter, opened: true })}`);
    await expect(row).toBeVisible();
  } finally { await ctx.close(); }
});

test('SP:consent', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const hits: string[] = [];
  page.on('request', (r) => { if (/posthog/i.test(r.url())) hits.push(r.url().slice(0, 80)); });
  try {
    await page.goto('/about', { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(8_000);
    const banner = page.getByRole('button', { name: /decline|reject|no thanks|essential only/i }).first();
    const shown = await banner.isVisible().catch(() => false); const before = hits.length;
    if (shown) { await banner.click(); await page.waitForTimeout(3_000); }
    const gone = shown ? !(await banner.isVisible().catch(() => false)) : null;
    console.log(`[SPEED] ${JSON.stringify({ title: 'SP:consent', bannerShown: shown, declinedAndGone: gone, posthogRequestsBeforeChoice: before, posthogRequestsAfterDecline: hits.length - before })}`);
    expect(shown, 'no consent banner with no stored choice').toBe(true); expect(gone, 'Decline did not hide the banner').toBe(true); expect(hits, 'PostHog was requested without consent').toEqual([]);
  } finally { await ctx.close(); }
});

test('SP:early-error', async ({ browser }) => {
  test.setTimeout(120_000);
  const marker = `qa-early-error-${Date.now()}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript((m) => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } setTimeout(() => { throw new Error(m); }, 0); }, marker);
  const page = await ctx.newPage(); const envelopes: string[] = [];
  await page.route((u) => TRACKER.test(u.toString()) && !/\/_next\//.test(u.pathname), async (route) => { const body = route.request().postData() ?? ''; envelopes.push(body.slice(0, 4000)); await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  try {
    await page.goto('/about', { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(25_000);
    const reached = envelopes.some((e) => e.includes(marker));
    console.log(`[SPEED] ${JSON.stringify({ title: 'SP:early-error', marker, trackerRequestsSeen: envelopes.length, markerReachedTracker: reached })}`);
    expect(reached, 'an error thrown before the app scripts ran never reached the tracker').toBe(true);
  } finally { await ctx.close(); }
});

/* SP2: WHO LOADED THE ANALYTICS / ERROR-REPORTING CHUNKS, AND WHEN (Dev's question on #2505). Cold load of /about at 390 px, normal network, with the consent store in three states: NONE (a first visit), GRANTED, DENIED (lhq_analytics_consent_v1).
 * Per chunk that mentions PostHog or the error tracker: initiator (CDP: type, script url, line), start time, response end, the load event end, and whether it started before load. Plus every network request to a PostHog host, with its time. */
for (const consent of ['none', 'granted', 'denied'] as const) {
  test(`SP2:${consent}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (consent !== 'none') await ctx.addInitScript((c) => { try { localStorage.setItem('lhq_analytics_consent_v1', c); } catch { /* private */ } }, consent);
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
    const init: Record<string, { type: string; url: string; line: number | null; frames: string[] }> = {}; const phReq: Array<{ url: string; at: number }> = []; const t0 = Date.now();
    cdp.on('Network.requestWillBeSent', (e: { request: { url: string }; initiator: { type: string; url?: string; lineNumber?: number; stack?: { callFrames: Array<{ url: string; functionName: string }> } } }) => {
      const u = e.request.url; if (/posthog/i.test(u) && !/\.js(\?|$)/.test(u)) phReq.push({ url: u.slice(0, 110), at: Date.now() - t0 });
      if (/\.js(\?|$)/.test(u)) init[u] = { type: e.initiator.type, url: (e.initiator.url ?? '').split('/').pop() ?? '', line: e.initiator.lineNumber ?? null, frames: (e.initiator.stack?.callFrames ?? []).slice(0, 3).map((f) => `${(f.url || '').split('/').pop()}:${f.functionName || '(anon)'}`) };
    });
    try {
      await page.goto('/about', { waitUntil: 'load', timeout: 60_000 }); await page.waitForTimeout(6_000);
      const r = await page.evaluate(async () => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; const loadEnd = nav.loadEventEnd; const res = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((x) => /\.js(\?|$)/.test(x.name));
        const out: Array<{ file: string; url: string; kb: number; startAt: number; doneAt: number; beforeLoad: boolean; has: string[]; initiatorType: string }> = [];
        for (const s of res) { let text = ''; try { text = await (await fetch(s.name, { cache: 'force-cache' })).text(); } catch { /* evicted */ } const has: string[] = []; if (/posthog/i.test(text)) has.push('posthog'); if (/glitchtip|sentry|\/envelope|__LHQ_EARLY/i.test(text)) has.push('error-reporting'); if (has.length) out.push({ file: s.name.split('/').pop() ?? '', url: s.name, kb: Math.round((s.transferSize || s.encodedBodySize) / 102.4) / 10, startAt: Math.round(s.startTime), doneAt: Math.round(s.responseEnd), beforeLoad: s.startTime < loadEnd, has, initiatorType: s.initiatorType }); }
        return { loadEventEnd: Math.round(loadEnd), chunks: out };
      });
      const chunks = r.chunks.map((c) => ({ ...c, initiator: init[c.url] ?? null, url: undefined }));
      console.log(`[SPEED2] ${JSON.stringify({ title: `SP2:${consent}`, consent, loadEventEnd: r.loadEventEnd, chunks, posthogNetworkRequests: phReq })}`);
    } finally { await ctx.close(); }
  });
}
