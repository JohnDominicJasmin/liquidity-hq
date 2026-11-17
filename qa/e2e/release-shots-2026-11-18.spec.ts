/* RELEASE SIGN-OFF SHOTS for PM (2026-11-18). Not a gate: it writes screenshots to qa/.shots and fails only if the page never draws.
 *   Pro BTC: the whole /arena and the Strategy panel, en and ru, light and dark, 390 / 768 / 1280
 *   Free HYPE (locks): the whole /arena, en, light and dark, 390 / 1280
 * Signed in as the DEV fixtures with the settings read patched to a clean row (no saved layers / strategy), the AI route fenced. */
import { test, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { settleForShot } from './_settle';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
async function open(browser: Browser, who: 'a' | 'b', lang: string, theme: string, width: number) {
  const ctx = await signedInContext(browser, who, { viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [lang, theme]);
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: lang, strategy_selection: null, strategy_params: null, arena_strategy: null }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) }); });
  return { ctx, page };
}
const save = async (page: Page, name: string) => { await settleForShot(page, 'release').catch(() => {}); await page.screenshot({ path: `qa/.shots/${name}.png`, timeout: 25_000 }).catch(() => {}); };

for (const lang of ['en', 'ru']) for (const theme of ['light', 'dark']) for (const width of [390, 768, 1280]) {
  test(`SHOT pro btc ${lang} ${theme} ${width}`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 'a', lang, theme, width);
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000);
      await save(page, `rel-arena-pro-btc-${lang}-${theme}-${width}`);
      const panel = page.locator('.strat-panel').first(); await panel.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800);
      await panel.screenshot({ path: `qa/.shots/rel-panel-pro-btc-${lang}-${theme}-${width}.png`, timeout: 25_000 }).catch(() => {});
    } finally { await ctx.close(); }
  });
}
for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  test(`SHOT free hype ${theme} ${width}`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 'b', 'en', theme, width);
    try { await gotoSignedIn(page, '/arena?coin=hype&tf=1h'); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000); await save(page, `rel-arena-free-hype-en-${theme}-${width}`); } finally { await ctx.close(); }
  });
}
