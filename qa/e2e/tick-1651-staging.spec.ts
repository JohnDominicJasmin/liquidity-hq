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

/* T1M: a MutationObserver from the first parse (addInitScript runs before any page script) records EVERY node or text the DOM ever holds that says "With Pro" / "Unlock with Pro", painted or not, with its time since the navigation started and whether it was visible (display / visibility / size) when inserted. 0 = no upsell ever entered the DOM for a Pro user. */
async function startMutationLoop(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __mo: { hits: Array<{ t: number; text: string; vis: boolean }>; proAt: number | null; obs: number } };
    w.__mo = { hits: [], proAt: null, obs: 0 };
    const RE = /(with pro|unlock with pro)[^\n]{0,60}/i;
    const note = (el: Element | null, text: string) => { const r = el ? (el as HTMLElement).getBoundingClientRect() : null; const cs = el ? getComputedStyle(el) : null; const vis = !!r && r.width > 0 && r.height > 0 && cs!.visibility !== 'hidden' && cs!.display !== 'none' && Number(cs!.opacity) > 0; w.__mo.hits.push({ t: Math.round(performance.now()), text: text.slice(0, 80), vis }); };
    const scan = (n: Node) => { const el = n.nodeType === 1 ? (n as Element) : n.parentElement; const tx = (n.textContent || ''); const m = RE.exec(tx); if (m) note(el, m[0]); };
    const start = () => {
      new MutationObserver((ms) => { w.__mo.obs += ms.length; for (const m of ms) { m.addedNodes.forEach(scan); if (m.type === 'characterData') scan(m.target); if (w.__mo.proAt == null && document.querySelector('.plan-badge-pro')) w.__mo.proAt = Math.round(performance.now()); } }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    };
    start();
  });
}
for (const path of ['/research', '/dashboard', '/arena', '/briefing', '/correlation']) {
  test(`T1M ${path}: no "With Pro" node ever enters the DOM for a Pro user (MutationObserver from navigation start)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page); await startMutationLoop(page); await startFlashLoop(page);
    try {
      await gotoSignedIn(page, path); await page.waitForTimeout(20_000);
      const r = await page.evaluate(() => { const w = window as unknown as { __mo: { hits: Array<{ t: number; text: string; vis: boolean }>; proAt: number | null; obs: number }; __fl: { frames: number; hits: number; first: number | null; proAt: number | null } }; return { mo: w.__mo, fl: w.__fl, pro: !!document.querySelector('.plan-badge-pro') }; });
      P(`T1M ${path}`, `DOM mutations seen ${r.mo.obs} · nodes saying "With Pro" ${r.mo.hits.length} (visible ${r.mo.hits.filter((h) => h.vis).length}) ${r.mo.hits.length ? JSON.stringify(r.mo.hits.slice(0, 3)) : ''} · painted frames with it ${r.fl.hits} of ${r.fl.frames} · Pro badge in the DOM at ${r.mo.proAt == null ? (r.pro ? 'page load (before the observer saw it)' : 'never') : r.mo.proAt + ' ms'}`);
      expect(r.pro, 'CONTROL: no Pro badge in the DOM at the end, so the account was not Pro in this run and the result means nothing').toBe(true);
      expect(r.mo.obs, 'CONTROL: the observer saw no DOM mutation at all, so it was not watching').toBeGreaterThan(50);
      expect.soft(r.mo.hits.length, `a "With Pro" node entered the DOM for a Pro user on ${path}: ${JSON.stringify(r.mo.hits.slice(0, 3))}`).toBe(0);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('T1C CONTROL /research signed out: the same observer DOES record the "With Pro" upsell for a visitor who is not Pro', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await installPaidAiFence(page); await startMutationLoop(page);
  try {
    await page.goto('/research', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(15_000);
    const r = await page.evaluate(() => (window as unknown as { __mo: { hits: Array<{ t: number; text: string; vis: boolean }>; obs: number } }).__mo);
    P('T1C /research signed out', `DOM mutations ${r.obs} · nodes saying "With Pro" ${r.hits.length} ${r.hits.length ? JSON.stringify(r.hits.slice(0, 2)) : ''}`);
    expect(r.hits.length, 'CONTROL FAILED: the observer recorded no upsell for a signed-out visitor, so a 0 for the Pro user proves nothing').toBeGreaterThan(0);
  } finally { await ctx.close().catch(() => {}); }
});

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
    /* WARM: a second visit in the same context (HTTP cache, JS chunks and the session already there), same measure. */
    const t1 = Date.now(); await page.goto('/research', { waitUntil: 'commit', timeout: 120_000 }); const wCommit = Date.now() - t1;
    let warmAt: number | null = null; const wDeadline = Date.now() + 90_000;
    while (Date.now() < wDeadline) {
      const s = await page.evaluate(() => { const t = document.body ? document.body.innerText : ''; return { preparing: /preparing the ai read/i.test(t), dry: /dry powder/i.test(t), busy: document.querySelectorAll('[aria-busy="true"], [class*="skeleton" i]').length, len: t.length }; }).catch(() => null);
      if (s && !s.preparing && s.dry && s.busy === 0 && s.len > 500) { warmAt = Date.now() - t1; break; }
      await page.waitForTimeout(100);
    }
    P('T3 /research', `WARM second visit, same context: navigation committed at ${wCommit} ms · content ready at ${warmAt == null ? 'NOT within 90 s' : warmAt + ' ms'}`);
    expect(readyAt, '/research never reached its content in 90 s').not.toBeNull();
  } finally { await ctx.close().catch(() => {}); }
});
