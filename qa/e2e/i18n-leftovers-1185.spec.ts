/* #1185 ru / ko / zh LEFTOVERS on PRODUCTION (signed out, read-only, GETs only). The tracker box names strings that were still English after the translation migrations; this prints, per locale and page, which of them are STILL in the visible text or in a title / aria-label attribute.
 *   [I18NL] <locale> <path>: {"english":[...strings still English...],"checked":N}
 * It asserts nothing (Dev decides which are deliberate: the Pro TF tooltips, the acronyms); one soft assertion per cell that the page loaded in the language (html[lang]). */
import { test, expect } from '@playwright/test';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

const CASES: Array<[string, string, string[]]> = [
  ['ru', '/upgrade', ['Not included:']],
  ['ru', '/arena?coin=btc', ['Weak signal', 'live']],
  ['ru', '/econ-calendar', ['official schedules: BLS, BEA, Census, Fed', 'NFP', 'GDP', 'PCE', 'CPI']],
  ['ru', '/dashboard', ['The only truth', 'The market is not trying to go up or down']],
  ['ru', '/correlation', ['Weak signal', 'Not included:']],
  ['ru', '/settings', ['Not included:']],
  ['ko', '/arena?coin=btc', ['Weak signal', 'live']],
  ['zh', '/arena?coin=btc', ['Weak signal', 'live']],
];
for (const [loc, path, needles] of CASES) {
  test(`I18NL ${loc} ${path}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, loc);
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(15_000);
      const r = await page.evaluate((ns) => {
        const text = (document.body.innerText || '').replace(/\s+/g, ' ');
        const attrs = Array.from(document.querySelectorAll('[title],[aria-label]')).map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`).join(' | ');
        const isLetter = (c: string) => /[A-Za-z]/.test(c);
        const has = (hay: string, n: string) => { let i = hay.indexOf(n); while (i >= 0) { const b = i === 0 ? '' : hay[i - 1], a = hay[i + n.length] ?? ''; if (!isLetter(b) && !isLetter(a)) return true; i = hay.indexOf(n, i + 1); } return false; };
        const english = ns.filter((n) => has(text, n) || has(attrs, n));
        const longDate = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/.exec(text)?.[0] ?? null;
        return { english, longDate, lang: document.documentElement.lang, len: text.length };
      }, needles);
      console.log(`[I18NL] ${loc} ${path}: ${JSON.stringify({ english: r.english, englishLongDate: r.longDate, htmlLang: r.lang, chars: r.len, checked: needles.length })}`);
      expect.soft(r.lang.toLowerCase().startsWith(loc), `html[lang] is ${r.lang}, not ${loc}`).toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
}
