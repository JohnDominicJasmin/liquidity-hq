/* the signed-in half of the "no failing data" sweep: Free and Pro fixtures on staging / CI builds only (see nofail-sweep.spec.ts). */
import { test } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { collect } from './_nofail';
const IN_PAGES = ['/arena?coin=btc', '/arena?coin=hype', '/dashboard', '/alerts', '/settings', '/research', '/journal', '/briefing', '/markets', '/scanner', '/correlation', '/funding', '/liq', '/news', '/hours', '/upgrade'];
for (const width of [390, 1280]) {
  for (const [who, tag] of [['b', 'free'], ['a', 'pro']] as const) for (const path of IN_PAGES) {
    test(`NF-${tag} ${path} ${width}`, async ({ browser }) => {
      test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(120_000); const ctx = await signedInContext(browser, who, { viewport: { width, height: width < 500 ? 844 : 900 } });
      await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      const page = await ctx.newPage();
      try { await gotoSignedIn(page, path); await page.waitForTimeout(22_000); console.log(`[NOFAIL] ${tag} ${path} ${width}: ${JSON.stringify({ hits: await page.evaluate(collect) })}`); } finally { await ctx.close(); }
    });
  }
}
