/* #1651 L102 / L103: HOW LONG UNTIL /upgrade AND /research ARE RESOLVED ON A FIRST SIGNED-IN VISIT? (target <= 5 s warm). A fresh signed-in context (empty cache and storage: a first visit), navigation start to:
 *   t_text      the first moment the page body holds more than 80 characters
 *   t_resolved  the first moment NOTHING is busy for two samples in a row (250 ms apart): no aria-busy, no skeleton / shimmer element, no testid containing "loading", and none of the words "preparing the AI read", "loading", "checking" in the main text, with more than 400 characters of body text
 * plus, every 2.5 s, what is still busy. /upgrade as the Free fixture (b) and as the Pro fixture (a); /research as the Pro fixture (a) and as Free (b). Run it twice on staging: first after the server has been idle (a COLD server wakes inside the first request: that wait is part of the first visit) and again straight after (WARM).
 * Prints [FV] lines; asserts nothing but that the page resolved within 60 s. Read-only. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const state = (page: Page) => page.evaluate(() => {
  const body = (document.body.innerText || '').replace(/\s+/g, ' ');
  const main = ((document.querySelector('main') as HTMLElement | null)?.innerText || body).replace(/\s+/g, ' ');
  const busyEls = Array.from(document.querySelectorAll('[aria-busy="true"], [class*="skeleton"], [class*="shimmer"], [data-testid*="loading"]')).filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => `${e.tagName.toLowerCase()}${(e as HTMLElement).dataset.testid ? '[' + (e as HTMLElement).dataset.testid + ']' : ''}.${String((e as HTMLElement).className).split(/\s+/)[0]}`);
  const words = /preparing the ai read|loading|checking/i.exec(main)?.[0] ?? null;
  return { len: body.length, busyEls: busyEls.slice(0, 4), words, head: body.slice(0, 110) };
});

for (const [path, who, fixture] of [['/upgrade', 'Free', 'b'], ['/upgrade', 'Pro', 'a'], ['/research', 'Pro', 'a'], ['/research', 'Free', 'b']] as const) {
  test(`FV ${path} first visit as ${who}`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, fixture, { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); const t0 = Date.now();
    try {
      await page.goto(`${baseURL ?? ''}${path}`, { waitUntil: 'commit', timeout: 120_000 });
      const tCommit = Date.now() - t0; let tText: number | null = null, tRes: number | null = null, calm = 0, last = await state(page).catch(() => null), next = 2_500;
      while (Date.now() - t0 < 60_000) {
        await page.waitForTimeout(250); const s = await state(page).catch(() => null); if (!s) continue; last = s; const el = Date.now() - t0;
        if (tText == null && s.len > 80) tText = el;
        const busy = s.busyEls.length > 0 || s.words != null || s.len < 400; calm = busy ? 0 : calm + 1;
        if (el >= next) { console.log(`[FV] ${path} ${who} +${(el / 1000).toFixed(1)}s: len ${s.len} busy ${JSON.stringify(s.busyEls)} word ${s.words}`); next += 2_500; }
        if (calm >= 2) { tRes = el - 250; break; }
      }
      console.log(`[FV] ${path} ${who}: response committed at ${(tCommit / 1000).toFixed(1)} s · first text ${tText == null ? 'never' : (tText / 1000).toFixed(1) + ' s'} · RESOLVED ${tRes == null ? 'NOT within 60 s' : (tRes / 1000).toFixed(1) + ' s'} · page "${last?.head ?? ''}"`);
      expect(tRes, `${path} as ${who} did not resolve within 60 s (still busy: ${JSON.stringify(last?.busyEls)} ${last?.words})`).not.toBeNull();
    } finally { await ctx.close().catch(() => {}); }
  });
}
