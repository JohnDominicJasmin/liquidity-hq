/* #2546: ru /markets at 390 with the OLD LONG short-signal labels forced ("Новые покупатели", "Умные покупатели", "Новые продавцы", "Умные продавцы"), so the CSS fix is judged on its own, independent of the shortened DB row. Signed out. Asserts the document is no wider than the viewport; prints the elements past the edge. */
import { test, expect } from '@playwright/test';
test('ML: ru /markets 390 with the long short-signal labels does not scroll sideways', async ({ browser }) => {
  test.setTimeout(120_000); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  await page.route(/\/api\/labels(\?|$)/, async (route) => { const res = await route.fetch(); const j = await res.json().catch(() => null) as { labels?: Record<string, string> } & Record<string, unknown> | null; if (!j) return route.fulfill({ response: res });
    const L = (j.labels ?? j) as Record<string, string>; Object.assign(L, { MARKETS_SIGNAL_NEW_BUYERS_SHORT: 'Новые покупатели', MARKETS_SIGNAL_SMART_BUYERS_SHORT: 'Умные покупатели', MARKETS_SIGNAL_NEW_SELLERS_SHORT: 'Новые продавцы', MARKETS_SIGNAL_SMART_SELLERS_SHORT: 'Умные продавцы' });
    return route.fulfill({ response: res, body: JSON.stringify(j) }); });
  try {
    await page.goto('/markets', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(16_000);
    /* CI data has no "new buyers" signal on any row (every row says "Нет сигнала"), so the long labels never reach the page: put the long text INTO every short-signal cell, then measure what the CSS under test does with it */
    await page.evaluate(() => { const L = ['Новые покупатели', 'Умные покупатели', 'Новые продавцы', 'Умные продавцы']; Array.from(document.querySelectorAll('.mkt-sig-short')).forEach((e, i) => { (e as HTMLElement).textContent = L[i % 4]; }); }); await page.waitForTimeout(800);
    const m = await page.evaluate(() => { const vw = document.documentElement.clientWidth; const clipAnc = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (/hidden|clip|auto|scroll/.test(getComputedStyle(a).overflowX) || getComputedStyle(a).position === 'fixed') return true; return false; };
      const past = Array.from(document.querySelectorAll('body *')).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > vw + 1 && !clipAnc(x.e)).map((x) => `${x.e.tagName.toLowerCase()}.${String((x.e as HTMLElement).className).slice(0, 24)} "${((x.e as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 22)}" r${Math.round(x.r.right)}`);
      const sig = Array.from(document.querySelectorAll('.mkt-sig-short')).map((e) => ((e as HTMLElement).innerText || '').trim()).slice(0, 6);
      return { vw, doc: document.documentElement.scrollWidth, past: past.slice(0, 8), sig }; });
    console.log(`[ML2546] ${JSON.stringify(m)}`); expect(m.doc, `ru /markets is ${m.doc}px wide at 390 with the long labels: ${m.past.join(' | ')}`).toBeLessThanOrEqual(m.vw);
  } finally { await ctx.close(); }
});
