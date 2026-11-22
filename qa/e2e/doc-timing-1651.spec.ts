/* #1651 /research DOCUMENT TIMING (Dev's request 2026-11-23): is a warm second visit slower than a cold first one, or is it the host? Paid routes stay STUBBED (installPaidAiFence); only the DOCUMENT is measured.
 * Per page (/research, and the controls /learn and /faq), 6 rounds, each in its own fresh context:
 *   rounds 1-3 COLD-FIRST: visit A (cold browser), wait 15 s, visit B (same context, page.goto, warm)
 *   rounds 4-6 WARM-FIRST: prime with /about (JS chunks, fonts, session cached), visit A of the page, wait 15 s, visit B
 * Per visit it prints [DOC1651] with the navigation entry (requestStart, responseStart, responseEnd, transferSize, nextHopProtocol) and the response headers age, x-nextjs-cache, x-render-origin-server, cf-cache-status, cache-control, server-timing, plus a latency floor from a plain request of the HTML and of /api/version in the same round.
 * DOC:out runs anywhere (production, signed out, GETs only); DOC:pro signs in as the Pro fixture (staging / qa only). Asserts only that a visit answered. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const PAGES = ['/research', '/learn', '/faq'] as const;
const HDRS = ['age', 'x-nextjs-cache', 'x-render-origin-server', 'cf-cache-status', 'cache-control', 'server-timing'] as const;

async function visit(page: Page, path: string, signedIn: boolean) {
  const t0 = Date.now();
  let status = 0; let hdr: Record<string, string> = {};
  if (signedIn) { await gotoSignedIn(page, path); }
  else { const r = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); status = r?.status() ?? 0; const h = r?.headers() ?? {}; hdr = Object.fromEntries(HDRS.map((k) => [k, h[k] ?? ''])); }
  const wall = Date.now() - t0;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; return n ? { requestStart: Math.round(n.requestStart), responseStart: Math.round(n.responseStart), responseEnd: Math.round(n.responseEnd), transferSize: n.transferSize, proto: n.nextHopProtocol } : null; }).catch(() => null);
  return { status, wall, nav, hdr };
}
async function ctxFor(browser: Browser, signedIn: boolean) {
  const ctx = signedIn ? await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }) : await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await installPaidAiFence(page); return { ctx, page };
}
for (const who of ['out', 'pro'] as const) {
  test(`DOC:${who} document timing, 6 rounds, cold-first then warm-first`, async ({ browser, request }) => {
    test.skip(who === 'pro' && !AUTH_READY, 'the Pro fixture does not exist on this host');
    test.setTimeout(1_500_000);
    const signedIn = who === 'pro'; let answered = 0;
    for (let round = 1; round <= 6; round++) {
      const t1 = Date.now(); const h = await request.get('/research', { maxRedirects: 0 }).catch(() => null); const f1 = Date.now() - t1;
      const t2 = Date.now(); await request.get('/api/version').catch(() => null); const f2 = Date.now() - t2;
      console.log(`[DOC1651] ${who} round ${round} FLOOR: plain GET /research ${h?.status() ?? 'ERR'} in ${f1} ms · /api/version in ${f2} ms`);
      for (const path of PAGES) {
        const { ctx, page } = await ctxFor(browser, signedIn);
        try {
          const warmFirst = round >= 4; if (warmFirst) await visit(page, '/about', signedIn);
          const a = await visit(page, path, signedIn); await page.waitForTimeout(15_000); const b = await visit(page, path, signedIn);
          if (a.nav && b.nav) answered++;
          for (const [tag, v] of [['A', a], ['B', b]] as const) console.log(`[DOC1651] ${who} round ${round} ${warmFirst ? 'WARM-FIRST' : 'COLD-FIRST'} ${path} visit ${tag}: status ${v.status || 'n/a'} wall ${v.wall} ms · nav ${JSON.stringify(v.nav)} · headers ${JSON.stringify(v.hdr)}`);
        } finally { await ctx.close().catch(() => {}); }
      }
    }
    expect(answered, 'no visit produced a navigation entry').toBeGreaterThan(0);
  });
}
