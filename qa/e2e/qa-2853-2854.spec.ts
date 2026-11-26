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

test('#2854 page not found follows the theme', async ({ browser }) => {
  for (const path of ['/qa-no-such-page', '/ko/nope']) for (const [width, height] of [[390, 844], [1280, 900]] as const) for (const theme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); const r = await page.goto(path, { waitUntil: 'load', timeout: 150_000 }); await page.waitForTimeout(5_000);
      const m = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, scrollWidth: document.documentElement.scrollWidth, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 40) }));
      console.log(`[V] 404 ${path} ${width} ${theme}: status=${r?.status()} ${JSON.stringify(m)}`);
      expect.soft(m.theme).toBe(theme); expect.soft(r?.status()).toBe(404);
      await page.screenshot({ path: `qa/.shots/pm103-404${path.replace(/\//g, '_')}-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  }
});

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

test('#2853 the tour in plain words', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  const before = await fixtureRows();
  for (const [width, theme, lang] of [[390, 'light', 'en'], [390, 'dark', 'en'], [1280, 'light', 'en'], [1280, 'dark', 'en'], [390, 'light', 'ko'], [390, 'light', 'zh'], [390, 'light', 'ru'], [1280, 'dark', 'ko'], [1280, 'dark', 'zh'], [1280, 'dark', 'ru']] as const) {
    const { ctx, page } = await open(browser, width, theme, lang);
    try {
      const dialog = await toTour(page); const codes: string[] = []; const texts: string[] = []; let wide = 0; let steps = 0;
      for (let step = 1; step <= 6; step++) {
        await page.waitForTimeout(5_000); steps = step;
        const m = await dialog.evaluate((d) => { const card = d.firstElementChild as HTMLElement; const r = card.getBoundingClientRect(); return { text: card.innerText.replace(/\s+/g, ' '), svg: Array.from(card.querySelectorAll('svg text')).map((t) => t.textContent).join(' '), over: Math.max(0, card.scrollWidth - card.clientWidth, Math.round(r.right - window.innerWidth), Math.round(-r.left)) }; });
        codes.push(...(`${m.text} ${m.svg}`.match(/(LONG|SHORT)_SQ|\bFR[+-](?![A-Za-z])/g) ?? [])); wide = Math.max(wide, m.over);
        const hit = m.text.match(/.{0,25}(Short-heavy|숏 우세|空头偏重|ерекос в шорты|Перекос в шорты|Shorts paying longs).{0,25}/g); if (hit) texts.push(`step ${step}: ${hit.slice(0, 3).join(' / ')}`);
        await page.screenshot({ path: `qa/.shots/pm104-tour-${lang}-${width}-${theme}-step${step}.png` });
        const last = /Arena|아레나|竞技场|Арен/i.test((await dialog.locator('button').last().innerText().catch(() => '')));
        if (last) break; await dialog.locator('button').last().click(); await page.waitForTimeout(600);
      }
      console.log(`[V] tour ${lang} ${width} ${theme}: steps=${steps} codes=${codes.length ? JSON.stringify([...new Set(codes)]) : 'none'} overflowPx=${wide} words=${JSON.stringify(texts.slice(0, 4))}`);
      expect.soft(codes).toEqual([]); expect.soft(wide).toBeLessThanOrEqual(1); expect.soft(texts.length).toBeGreaterThan(0);
    } finally { await ctx.close().catch(() => {}); }
  }
  const after = await fixtureRows();
  expect(after.settings, 'THE RUN CHANGED THE FIXTURE SETTINGS ROW').toEqual(before.settings); expect(after.onboarding, 'THE RUN CHANGED THE FIXTURE ONBOARDING ROW').toEqual(before.onboarding); console.log('[V] fixture rows unchanged');
});
