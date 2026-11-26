/* QA: PR #2858 in a browser (runner build): tour step 1 in en, ko, zh, ru at 360 and 390, dark and light. Test ref only.
 * The tour is reached through the wizard with every write answered by the test, the service worker blocked, and the fixture's rows compared before and after. Prints [T58] lines. */
import { test, expect, type Browser } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AUTH_READY, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.describe.configure({ timeout: 900_000, retries: 0 });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };
const ROW = { tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false };
async function fixtureRows() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''; expect(new URL(url).hostname.split('.')[0], 'dev project only').toBe('wdtjhrilakoitfcezxpx');
  const sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: process.env.E2E_USER_A_EMAIL ?? '', password: process.env.E2E_USER_A_PASSWORD ?? '' }); expect(error?.message ?? null).toBeNull();
  const one = async (t: string) => { const r = await sb.from(t).select('*').eq('user_id', data.user!.id).maybeSingle(); expect(r.error?.message ?? null, t).toBeNull(); return r.data; };
  return { settings: await one('lhq_dev_user_settings'), onboarding: await one('lhq_dev_user_onboarding') };
}
async function open(browser: Browser, width: number, theme: 'dark' | 'light', lang: string) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 844 }, theme });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } }, lang);
  await ctx.route(/\/(rest\/v1|api)\//, async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname; const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !/\/rpc\//.test(path);
    if (req.method() === 'OPTIONS' && /\/rest\//.test(path)) return route.fulfill({ status: 204, headers: CORS });
    if (write) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(path === '/api/settings' ? { accepted: [], rejected: [], settings: null } : []) });
    if (/user_onboarding$/.test(path)) { const one = /vnd\.pgrst\.object/.test(req.headers().accept ?? ''); return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(one ? ROW : [ROW]) }); }
    if (req.method() === 'GET' && /user_settings$/.test(path)) { const r = await route.fetch(); const body = await r.json().catch(() => null); const set = (x: Record<string, unknown>) => ({ ...x, language: lang }); return route.fulfill({ response: r, json: Array.isArray(body) ? body.map(set) : body ? set(body) : body }); }
    return route.fallback();
  });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page };
}

test('#2858 tour step 1 fits', async ({ browser }, testInfo) => {
  test.skip(!AUTH_READY, 'no fixtures'); test.skip(testInfo.project.name !== 'desktop', 'sizes are set here');
  const before = await fixtureRows();
  for (const width of [360, 390] as const) for (const theme of ['light', 'dark'] as const) for (const lang of ['en', 'ko', 'zh', 'ru'] as const) {
    const { ctx, page } = await open(browser, width, theme, lang);
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      await page.locator('[class*="obw-"]').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(2_000);
      for (let s = 0; s < 6 && !(await page.locator('.obw-skip').isVisible().catch(() => false)); s++) {
        const country = page.locator('button.obw-select'); if (await country.isVisible().catch(() => false)) { await country.click(); await page.locator('.obw-menu-opt').first().click({ timeout: 10_000 }); }
        await page.locator('.obw-tile, .obw-row, .obw-chip').first().click({ timeout: 10_000 }); await page.locator('.obw-btn-next').click({ timeout: 10_000 }); await page.waitForTimeout(700);
      }
      await page.locator('.obw-skip').click({ timeout: 20_000 });
      const dialog = page.locator('.tour-term-wrap[role="dialog"]'); await dialog.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(4_000);
      const m = await dialog.evaluate((d) => { const card = d.firstElementChild as HTMLElement; const c = card.getBoundingClientRect(); const labels = Array.from(card.querySelectorAll('div')).filter((e) => getComputedStyle(e).textAlign === 'center' && e.children.length >= 3 && e.parentElement!.children.length === 3);
        return { tour: Math.round(c.width), over: card.scrollWidth - card.clientWidth, small: labels.map((e) => { const r = e.getBoundingClientRect(); const inner = Array.from(e.children).map((k) => (k as HTMLElement).scrollWidth - (k as HTMLElement).clientWidth); return { w: Math.round(r.width), h: Math.round(r.height), pastTour: Math.round(r.right - c.right), spill: Math.max(0, e.scrollWidth - e.clientWidth, ...inner), text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 60) }; }) }; });
      console.log(`[T58] ${lang} ${width} ${theme}: tour=${m.tour} over=${m.over} cards=${JSON.stringify(m.small.map((x) => [x.w, x.h, x.pastTour, x.spill]))}${lang === 'ru' && theme === 'light' ? ' ' + JSON.stringify(m.small.map((x) => x.text)) : ''}`);
      expect.soft(m.small.length, 'three cards found').toBe(3); expect.soft(m.over).toBeLessThanOrEqual(0); for (const x of m.small) { expect.soft(x.pastTour).toBeLessThanOrEqual(0); expect.soft(x.spill).toBeLessThanOrEqual(1); }
      await page.screenshot({ path: `qa/.shots/pm105-tour-${lang}-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  }
  const after = await fixtureRows(); expect(after.settings).toEqual(before.settings); expect(after.onboarding).toEqual(before.onboarding); console.log('[T58] fixture rows unchanged');
});
