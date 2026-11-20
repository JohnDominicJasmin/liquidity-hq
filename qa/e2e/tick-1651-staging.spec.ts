/* #1651 owner-order items 2 and 4, on STAGING (same commit and DB as the release; the Pro fixture is a test account on a test host), signed in as the Pro fixture 'a', read-only (GETs; nothing clicked, nothing saved; the paid-AI fence is installed first).
 *   T1 /research: does "With Pro: Stablecoin Dry Powder" (or any "With Pro" upsell) EVER paint for a Pro user? A requestAnimationFrame loop from the first frame records every frame whose visible text contains "With Pro"; 0 frames = the box's claim holds. The moment the Pro badge became visible is recorded to show the loop covered the plan-resolution window.
 *   T2 /dashboard: the same loop (the Dashboard multi-timeframe rows are in the same box).
 *   T3 /research FIRST VISIT, cold tab (new browser context, empty cache): time from navigation to content (no "Preparing the AI read", no skeleton / aria-busy in the page, "Dry Powder" present), plus the server's time to first byte (a sleeping free-plan host shows up here).
 * Prints [T1651] lines. Soft assertions: T1/T2 flash frames == 0, T3 content under 3 s is reported, not asserted. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const P = (id: string, msg: string) => console.log(`[T1651] ${id} ${msg}`);

async function startFlashLoop(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __fl: { frames: number; hits: number; first: number | null; last: number | null; sample: string; proAt: number | null; t0: number } };
    w.__fl = { frames: 0, hits: 0, first: null, last: null, sample: '', proAt: null, t0: performance.now() };
    const tick = () => {
      const b = document.body; const now = performance.now() - w.__fl.t0;
      if (b) {
        w.__fl.frames++;
        const t = b.innerText || '';
        const m = /with pro[^\n]{0,60}/i.exec(t);
        if (m) { w.__fl.hits++; if (w.__fl.first == null) { w.__fl.first = now; w.__fl.sample = m[0].slice(0, 80); } w.__fl.last = now; }
        if (w.__fl.proAt == null && document.querySelector('.plan-badge-pro')) w.__fl.proAt = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

for (const path of ['/research', '/dashboard']) {
  test(`T1/T2 ${path}: a Pro user never sees a "With Pro" upsell frame`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page); await startFlashLoop(page);
    try {
      await gotoSignedIn(page, path); await page.waitForTimeout(25_000);
      const r = await page.evaluate(() => (window as unknown as { __fl: { frames: number; hits: number; first: number | null; last: number | null; sample: string; proAt: number | null } }).__fl);
      P(path, `frames sampled ${r.frames} · frames containing "With Pro" ${r.hits} (first at ${r.first == null ? 'never' : Math.round(r.first) + ' ms'}, last ${r.last == null ? 'never' : Math.round(r.last) + ' ms'}) sample "${r.sample}" · Pro badge visible at ${r.proAt == null ? 'never' : Math.round(r.proAt) + ' ms'} after the first frame`);
      expect(r.proAt, 'CONTROL: the Pro badge never showed, so the account was not Pro in this run and the result means nothing').not.toBeNull();
      expect.soft(r.hits, `a "With Pro" upsell painted ${r.hits} frame(s) for a Pro user on ${path}: "${r.sample}"`).toBe(0);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('T3 /research first visit, cold tab, signed in Pro: time to content', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  try {
    const t0 = Date.now(); const nav = page.goto('/research', { waitUntil: 'commit', timeout: 120_000 });
    await nav; const tCommit = Date.now() - t0;
    let readyAt: number | null = null; const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => { const t = document.body ? document.body.innerText : ''; return { preparing: /preparing the ai read/i.test(t), dry: /dry powder/i.test(t), busy: document.querySelectorAll('[aria-busy="true"], [class*="skeleton" i]').length, len: t.length }; }).catch(() => null);
      if (s && !s.preparing && s.dry && s.busy === 0 && s.len > 500) { readyAt = Date.now() - t0; break; }
      await page.waitForTimeout(100);
    }
    const ttfb = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null; }).catch(() => null);
    P('T3 /research', `cold tab (new context): navigation committed at ${tCommit} ms · server time to first byte ${ttfb?.ttfb ?? 'n/a'} ms · content ready (no "Preparing the AI read", no skeleton / aria-busy, "Dry Powder" shown) at ${readyAt == null ? 'NOT within 90 s' : readyAt + ' ms'} · DOMContentLoaded ${ttfb?.dcl ?? 'n/a'} ms`);
    expect(readyAt, '/research never reached its content in 90 s').not.toBeNull();
  } finally { await ctx.close().catch(() => {}); }
});
