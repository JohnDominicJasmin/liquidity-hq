/* #2309 changes app/globals.css (a landing gate file): render / at 390 and 1280, light and dark, and read the footer links and the page width. Signed out, reads only. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';
mkdirSync('qa/.shots', { recursive: true });
for (const w of [390, 1280]) for (const th of ['dark', 'light'] as const) test(`L. / at ${w} ${th}: footer links, page width, shot`, async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [th]);
  const page = await ctx.newPage();
  try {
    await gotoGuarded(page, '/'); await page.waitForTimeout(9_000);
    const m = await page.evaluate(() => ({ docSw: document.documentElement.scrollWidth, vw: window.innerWidth, links: Array.from(document.querySelectorAll('footer a, .pf-footer-bottom-link, .support-mail-link')).map(a => { const r = (a as HTMLElement).getBoundingClientRect(); return { t: (a.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.w > 0) }));
    console.log(`[L] ${w} ${th} docSw=${m.docSw} links=${JSON.stringify(m.links)}`);
    await page.locator('footer').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `qa/.shots/landing-2309-${w}-${th}.png` });
    expect(m.docSw).toBeLessThanOrEqual(m.vw);
  } finally { await ctx.close(); }
});
