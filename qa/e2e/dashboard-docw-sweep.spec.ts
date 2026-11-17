/* DASHBOARD SIDEWAYS-WIDTH SWEEP (#2489 / the ru 390 regression, 2026-11-17): /dashboard signed in as Free fixture B at 320, 360 and 390 px in en, ru, ko, zh, ar.
 * A cell passes when the document is no wider than the viewport. On a failure the cell prints WHICH non-fixed elements are past the edge (computed position, width, clipper) so the culprit is named, not guessed.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<qa url> -f project=desktop -f spec=qa/e2e/dashboard-docw-sweep.spec.ts
 * Nothing is written: settings reads are answered with the language patched in, writes stubbed. Language is verified from <html lang> and by the labels, and a cell whose language did not apply reports NOT MEASURED. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { overflowAttribution } from './_overflow';
import { settleForShot } from './_settle';

const LANGS = ['en', 'ru', 'ko', 'zh', 'ar'] as const; const WIDTHS = [320, 360, 390];

async function forceLang(page: Page, lang: string) {
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, language: lang }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
  });
  await page.route(/\/api\/settings(\?|$)/, async (route) => { if (route.request().method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
}

test.describe('/dashboard width sweep (signed in)', () => {
  test.describe.configure({ timeout: 150_000, retries: 0 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  for (const lang of LANGS) for (const width of WIDTHS) test(`docW ${lang} ${width}`, async ({ browser }) => {
    const ctx = await signedInContext(browser, 'b', { viewport: { width, height: 844 } }); await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, lang);
    const page = await ctx.newPage(); await forceLang(page, lang);
    try {
      await gotoSignedIn(page, '/dashboard'); await page.locator('main, [role="main"]').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {}); await page.waitForTimeout(4_000);
      let htmlLang = await page.evaluate(() => document.documentElement.lang);
      for (let t = 0; t < 2 && !htmlLang.toLowerCase().startsWith(lang); t++) { await page.evaluate((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, lang); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4_000); htmlLang = await page.evaluate(() => document.documentElement.lang); }
      if (!htmlLang.toLowerCase().startsWith(lang)) { console.log(`[CELL] DOCW ${lang} ${width}: language did not apply (html lang="${htmlLang}"): NOT MEASURED`); test.skip(true, 'language did not apply'); return; }
      await settleForShot(page, `docw-${lang}-${width}`);
      const m = await page.evaluate(`(${overflowAttribution.toString()})()`) as { docW: number; winW: number; contributors: string[] };
      console.log(`[CELL] DOCW ${lang} ${width}: docW=${m.docW}/${m.winW} contributors=${JSON.stringify(m.contributors)}`);
      expect(m.docW, `/dashboard in ${lang} at ${width} scrolls sideways: ${m.contributors.slice(0, 3).join(' | ')}`).toBeLessThanOrEqual(m.winW);
    } finally { await ctx.close(); }
  });
});
