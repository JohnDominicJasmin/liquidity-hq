/* QA on qa 525cc68: #2853 (tour card in plain words, #1185 item 104) and #2854 ("page not found" follows the theme, item 103), with PM's screenshots.
 * The tour is reached through the wizard with every write answered by the test (tables AND the app's own routes), the service worker blocked, and the fixture's rows compared before and after.
 * The account language is made at the network by answering the settings read. Dispatch-only; prints [V] lines. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AUTH_READY, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 600_000, retries: 0 });
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
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 }, theme });
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
async function toTour(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 });
  await page.locator('[class*="obw-"]').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(2_500);
  for (let s = 0; s < 6 && !(await page.locator('.obw-skip').isVisible().catch(() => false)); s++) {
    const country = page.locator('button.obw-select');
    if (await country.isVisible().catch(() => false)) { await country.click(); await page.locator('.obw-menu-opt').first().click({ timeout: 10_000 }); }
    await page.locator('.obw-tile, .obw-row, .obw-chip').first().click({ timeout: 10_000 });
    await page.locator('.obw-btn-next').click({ timeout: 10_000 }); await page.waitForTimeout(900);
  }
  await page.locator('.obw-skip').click({ timeout: 20_000 });
  const dialog = page.locator('.tour-term-wrap[role="dialog"]'); await dialog.waitFor({ state: 'visible', timeout: 60_000 }); return dialog;
}

test('#2853 which element overflows, Russian', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  const before = await fixtureRows();
  for (const [width, lang] of [[390, 'ru'], [360, 'ru'], [390, 'en'], [360, 'en']] as const) {
    const { ctx, page } = await open(browser, width, 'light', lang);
    try {
      const dialog = await toTour(page);
      for (let step = 1; step <= 2; step++) {
        await page.waitForTimeout(5_000);
        const m = await dialog.evaluate((d) => { const card = d.firstElementChild as HTMLElement; const c = card.getBoundingClientRect(); const out = Array.from(card.querySelectorAll('*')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > c.right + 1; }); const name = (e: Element) => `${e.tagName.toLowerCase()} "${((e as HTMLElement).innerText ?? '').replace(/s+/g, ' ').slice(0, 40)}" right+${Math.round(e.getBoundingClientRect().right - c.right)} w=${Math.round(e.getBoundingClientRect().width)}`;
          return { card: Math.round(c.width), scrollMinusClient: card.scrollWidth - card.clientWidth, offLeft: Math.round(Math.max(0, -c.left)), offRight: Math.round(Math.max(0, c.right - window.innerWidth)), past: out.slice(-6).map(name), count: out.length }; });
        console.log(`[V] probe ${lang} ${width} step ${step}: ${JSON.stringify(m)}`);
        await page.screenshot({ path: `qa/.shots/pm104-probe-${lang}-${width}-step${step}.png` });
        if (step === 1) { await dialog.locator('button').last().click(); await page.waitForTimeout(600); }
      }
    } finally { await ctx.close().catch(() => {}); }
  }
  const after = await fixtureRows(); expect(after.settings).toEqual(before.settings); expect(after.onboarding).toEqual(before.onboarding); console.log('[V] fixture rows unchanged');
});
