/* QA probe (not for merge): which element makes /markets ru 388 wide at 360 when no rect passes 360. Lists every element whose right edge or scrollWidth passes the viewport. */
import { test } from '@playwright/test';
import { gotoGuarded } from './_shared';
test('probe: ru /markets at 360', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
  const page = await ctx.newPage(); await gotoGuarded(page, '/markets'); await page.waitForTimeout(14_000);
  const out = await page.evaluate(() => {
    const vw = 360; const r: unknown[] = [];
    document.querySelectorAll('body *').forEach(e => { const el = e as HTMLElement; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (b.width === 0 && b.height === 0) return; if (el.closest('.nav-menu')) return;
      if (b.right > vw + 0.5 || el.scrollWidth > el.clientWidth + 0.5 && el.clientWidth > 0 && cs.overflowX === 'visible' && el.scrollWidth + b.left > vw + 0.5)
        r.push({ t: el.tagName, c: String(el.className).slice(0, 50), right: Math.round(b.right), sw: el.scrollWidth, cw: el.clientWidth, pos: cs.position, txt: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 40) }); });
    return { docSw: document.documentElement.scrollWidth, bodySw: document.body.scrollWidth, n: r.length, items: r.slice(0, 14) };
  });
  console.log('[PROBE] ' + JSON.stringify(out));
  await ctx.close();
});
