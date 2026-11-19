/* #2542 STRATEGY PANEL LEFTOVERS TRANSLATED (needs the DEV label block 20261119e applied): ru / ko / zh, Pro and Free, 1280.
 *   PI1 Pro: the indicator chip descriptions and the settings box ("Edit settings": parameter names and the enum options) carry no English parameter / description words
 *   PI2 Pro: the "{n} on" indicator counter is translated (no bare English "on" next to a number)
 *   PI3 Free: the Free-limit line and the defaults note are translated
 * Prints the panel text it judged. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const EN = ['Simple', 'moving', 'average', 'Parabolic', 'trend', 'Momentum', 'crossovers', 'Volatility', 'Length', 'Weight', 'Multiplier', 'Conversion', 'Smoothing', 'Overbought', 'Oversold', 'Lookback', 'Baseline', 'Anchor', 'Free limit', 'Defaults on free'];
async function open(browser: Browser, who: 'a' | 'b', lang: string) {
  const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, lang);
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: lang, strategy_selection: ['SMA'], strategy_params: null, arena_strategy: null }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) }); });
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000);
  return { ctx, page };
}
const panelText = async (page: Page) => ((await page.locator('.strat-panel').first().innerText()) || '').replace(/\s+/g, ' ');
const english = (t: string) => EN.filter((w) => new RegExp(`\b${w}\b`).test(t));

for (const lang of ['ru', 'ko', 'zh']) {
  test(`PI1/PI2:${lang}: Pro panel chips, settings box and counter are translated`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 'a', lang);
    try {
      const edit = page.locator('button.strat-edit-link').first(); if ((await edit.getAttribute('aria-expanded').catch(() => null)) === 'false') await edit.click().catch(() => undefined); await page.waitForTimeout(1_000);
      const t = await panelText(page); const en = english(t);
      const counter = await page.locator('.strat-count').first().innerText().catch(() => '');
      console.log(`[PANELI18N] ${lang} pro: english words ${JSON.stringify(en)}; counter "${counter.replace(/\s+/g, ' ')}"; text ${t.slice(0, 420)}`);
      expect(en, `English words left in the ${lang} Pro panel`).toEqual([]);
      if (counter) expect(/\bon\b/i.test(counter), `the "{n} on" counter is English in ${lang}: "${counter}"`).toBe(false);
    } finally { await ctx.close(); }
  });
  test(`PI3:${lang}: Free panel limit line is translated`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 'b', lang);
    try { const t = await panelText(page); const en = english(t); console.log(`[PANELI18N] ${lang} free: english words ${JSON.stringify(en)}; text ${t.slice(0, 300)}`); expect(en, `English words left in the ${lang} Free panel`).toEqual([]); } finally { await ctx.close(); }
  });
}
