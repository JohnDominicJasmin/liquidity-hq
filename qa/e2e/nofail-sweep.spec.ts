/* THE "NO FAILING DATA" SWEEP (owner order 2026-11-18): every page, 390 and 1280, as a USER: collect every VISIBLE instance of a failing-data word or placeholder, and every spinner / "Loading" still there after 22 s.
 * READ-ONLY on production (signed out, GETs only). On staging the same list also runs signed in as the Free and Pro fixtures (specs with `-pro` / `-free` in the title).
 *   [NOFAIL] <persona> <path> <width>: {"hits":[{"el":"div.cls","text":"...","kind":"word|placeholder|spinner|loading","ctx":"nearest label"}...]}
 * Words: unavailable, no data, not available, couldn't, could not, failed, error, retry, try again, NaN, undefined, null, "—" / "--" / "-" alone, "n/a". Asserts nothing: the table is built from the log. */
import { test } from '@playwright/test';
import { collect } from './_nofail';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

const OUT_PAGES = ['/', '/about', '/faq', '/markets', '/dashboard', '/briefing', '/correlation', '/scanner', '/news', '/funding', '/liq', '/hours', '/upgrade', '/changelog', '/login', '/arena?coin=btc', '/arena?coin=hype'];
for (const width of [390, 1280]) {
  for (const path of OUT_PAGES) {
    test(`NF-out ${path} ${width}`, async ({ browser }) => {
      test.setTimeout(120_000); const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
      await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      const page = await ctx.newPage();
      try { await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(22_000); console.log(`[NOFAIL] out ${path} ${width}: ${JSON.stringify({ hits: await page.evaluate(collect) })}`); } finally { await ctx.close(); }
    });
  }
}
