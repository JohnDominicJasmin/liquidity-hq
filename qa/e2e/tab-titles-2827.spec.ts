/* QA: PR #2827 in a browser (runner build or deployed): the tab title after load, after moving between pages inside the app, and after switching back to English. Prints [TT] lines. */
import { test, expect, type Page } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.describe.configure({ timeout: 240_000 });
const settle = async (page: Page) => { await page.waitForTimeout(7_000); return page.evaluate(() => document.title); };
/* In-app navigation: the router's own push, so the document is not reloaded. */
const go = async (page: Page, path: string) => {
  const clicked = await page.evaluate((p) => { const a = Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[href="${p}"]`))[0]; if (!a) return false; a.click(); return true; }, path);
  if (clicked) await page.waitForURL((u) => u.pathname === path, { timeout: 90_000 });
  return clicked;
};
for (const lang of ['en', 'ko'] as const) {
  test(`TT ${lang}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('qa-set')) { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); sessionStorage.setItem('qa-set', '1'); } } catch { /* private */ } }, lang);
    const page = await ctx.newPage(); const seen: Record<string, string> = {};
    try {
      await installPaidAiFence(page);
      for (const path of ['/arena', '/funding', '/privacy', '/upgrade']) { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); seen[path] = await settle(page); console.log(`[TT] ${lang} load ${path}: ${JSON.stringify(seen[path])}`); }
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 }); console.log(`[TT] ${lang} load /dashboard: ${JSON.stringify(await settle(page))}`);
      await page.evaluate(() => { (window as unknown as { qaSameDocument: boolean }).qaSameDocument = true; });
      for (const path of ['/funding', '/arena', '/privacy', '/upgrade', '/dashboard', '/funding']) {
        const ok = await go(page, path);
        if (!ok) { console.log(`[TT] ${lang} click ${path}: no link on this page`); continue; }
        const title = await settle(page);
        console.log(`[TT] ${lang} click ${path}: ${JSON.stringify(title)} sameDocument=${await page.evaluate(() => !!(window as unknown as { qaSameDocument?: boolean }).qaSameDocument)}`);
        if (seen[path]) expect.soft(title, `${lang} ${path}: the title after a click differs from the title after a load`).toBe(seen[path]);
      }
      if (lang === 'ko') {
        for (const path of ['/arena', '/funding', '/privacy']) expect.soft(seen[path], path).toMatch(/ - LiquidityHQ$/);
        await page.evaluate(() => localStorage.setItem('lhq_lang_v1', 'en')); await page.reload({ waitUntil: 'domcontentloaded' });
        console.log(`[TT] ko then en /funding: ${JSON.stringify(await settle(page))}`);
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}
