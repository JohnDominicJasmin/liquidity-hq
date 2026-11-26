/* QA: PM's visual checks on staging, second pass (#62, #71 tour, #72, and the #70 text), 390 and 1280, dark and light. The first pass (run 45819770321) holds #43, #70 and the #71 pill.
 * Account states are MADE AT THE NETWORK for a dev-project fixture: the onboarding row is answered by the test and EVERY table write from the page is answered by the test too, so nothing is changed.
 * The service worker is blocked so the stubs hold. The liquidation events are TEST DATA placed around the live price (the shared dev database holds none from the last 24 h). Dispatch-only; prints [PM] lines. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 600_000, retries: 0 });
const SIZES = [[390, 844], [1280, 900]] as const;
const THEMES = ['dark', 'light'] as const;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };

const snap = async (page: Page, name: string) => page.screenshot({ path: `qa/.shots/${name}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/\\S+@\\S+\\.\\w+/')], maskColor: '#000000' });
async function open(browser: Browser, width: number, height: number, theme: 'dark' | 'light', row: Record<string, unknown> | null) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height }, theme });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } });
  const stubbed: string[] = [];
  if (row) {
    await ctx.route(/\/rest\/v1\/(?!rpc\/)/, async (route) => {
      const req = route.request(); const table = /\/rest\/v1\/([a-z_]+)/.exec(req.url())?.[1] ?? '?';
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (req.method() !== 'GET' && req.method() !== 'HEAD') { stubbed.push(`${req.method()} ${table}`); return route.fulfill({ status: 201, headers: CORS, contentType: 'application/json', body: '[]' }); }
      if (!/user_onboarding$/.test(table)) return route.continue();
      const one = /vnd\.pgrst\.object/.test(req.headers().accept ?? '');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(one ? row : [row]) });
    });
    /* THE APP ALSO SAVES THROUGH ITS OWN ROUTES (/api/settings): without this the wizard really saved its answers to the fixture (run 45827918086). */
    await ctx.route(/\/api\//, async (route) => { const req = route.request(); if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback(); stubbed.push(`${req.method()} ${new URL(req.url()).pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
  }
  const page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page, stubbed };
}
const ROW = { tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false };

test('#72 wizard keyboard focus, then #71 the tour Example tag', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const { ctx, page, stubbed } = await open(browser, w, h, theme, ROW);
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const shown = await page.locator('[class*="obw-"]').first().waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false); await page.waitForTimeout(3_000);
      let focus: unknown = null;
      for (let i = 0; shown && i < 30; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(150);
        focus = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || !e.closest('[class*="obw"]')) return null; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), label: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').slice(0, 40), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, shadow: s.boxShadow.slice(0, 60), border: s.borderColor }; });
        if (focus) break;
      }
      await page.waitForTimeout(500);
      console.log(`[PM] 72 ${w} ${theme}: wizard=${shown} firstFocus=${JSON.stringify(focus)}`);
      await snap(page, `pm72-wizard-focus-${w}-${theme}`); expect.soft(focus).not.toBeNull();
      /* the skip button is only on the last step: answer the steps (nothing is saved, every write is answered by the test) */
      for (let s = 0; s < 6 && !(await page.locator('.obw-skip').isVisible().catch(() => false)); s++) {
        const country = page.getByRole('button', { name: /select your country/i }).or(page.getByRole('combobox', { name: /country|select/i })).first();
        if (await country.isVisible().catch(() => false)) { await country.click(); await page.locator('.obw-menu-opt').first().click({ timeout: 10_000 }); }
        await page.locator('.obw-tile, .obw-row, .obw-chip').first().click({ timeout: 10_000 });
        await page.locator('.obw-btn-next').click({ timeout: 10_000 }); await page.waitForTimeout(900);
      }
      await page.locator('.obw-skip').click({ timeout: 20_000 });
      const dialog = page.locator('.tour-term-wrap[role="dialog"]');
      const opened = await dialog.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
      let found = false; let step = 1; const pressed: string[] = [];
      for (; opened && step <= 8; step++) {
        await page.waitForTimeout(800);
        if (await dialog.getByText('Example', { exact: true }).isVisible().catch(() => false)) { found = true; break; }
        const next = dialog.locator('button').last(); pressed.push((await next.innerText().catch(() => '')).trim()); await next.click();
        await page.waitForTimeout(700); if (!(await dialog.isVisible().catch(() => false))) break;
      }
      if (found) await page.waitForTimeout(4_500);
      console.log(`[PM] 71 tour ${w} ${theme}: opened=${opened} exampleTag=${found} onStep=${found ? step : null} pressed=${JSON.stringify(pressed)} writesAnsweredByTest=${JSON.stringify([...new Set(stubbed)])}`);
      await snap(page, `pm71-tour-example-tag-${w}-${theme}`); expect.soft(found).toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  }
});

