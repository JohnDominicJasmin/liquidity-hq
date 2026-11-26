/* QA: PM's five visual checks on staging (#43, #62, #70, #71, #72), 390 and 1280, dark and light. Screenshots only; it reports what it reached.
 * Account states are MADE AT THE NETWORK for a dev-project fixture: the onboarding row is answered by the test and every write to it or to the settings row is answered too, so nothing is changed.
 * The service worker is blocked so the stubs hold. Dispatch-only; prints [PM] lines. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 600_000, retries: 0 });
const SIZES = [[390, 844], [1280, 900]] as const;
const THEMES = ['dark', 'light'] as const;

const snap = async (page: Page, name: string) => page.screenshot({ path: `qa/.shots/${name}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/\\S+@\\S+\\.\\w+/')], maskColor: '#000000' });
async function open(browser: Browser, width: number, height: number, theme: 'dark' | 'light', row: Record<string, unknown> | null) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height }, theme });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.removeItem('lhq_setup_dismissed'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } });
  const stubbed: string[] = [];
  if (row) {
    await ctx.route(/\/rest\/v1\/lhq(_dev)?_user_(onboarding|settings)(\?|$)/, async (route) => {
      const req = route.request(); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const onboarding = /user_onboarding/.test(req.url());
      if (req.method() !== 'GET') { stubbed.push(`${req.method()} ${onboarding ? 'onboarding' : 'settings'}`); return route.fulfill({ status: 201, headers: cors, contentType: 'application/json', body: '[]' }); }
      if (!onboarding) return route.continue();
      const one = /vnd\.pgrst\.object/.test(req.headers().accept ?? '');
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(one ? row : [row]) });
    });
  }
  const page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page, stubbed };
}
const ROW = { tour_seen: true, profile_complete: true, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false };

test('#70 page not found', async ({ browser }) => {
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); const r = await page.goto('/qa-no-such-page', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(6_000);
      console.log(`[PM] 70 ${w} ${theme}: status=${r?.status()} heading=${JSON.stringify((await page.locator('h1, h2').first().innerText().catch(() => '')).slice(0, 60))} scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      await snap(page, `pm70-page-not-found-${w}-${theme}`);
    } finally { await ctx.close().catch(() => {}); }
  }
});

test('#43 could not verify plan', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const { ctx, page } = await open(browser, w, h, theme, null);
    await ctx.addInitScript(() => { (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = true; });
    try {
      await gotoSignedIn(page, '/arena'); const card = page.locator('[data-testid="entitlement-unknown"]').first();
      const seen = await card.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
      if (seen) { await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); }
      console.log(`[PM] 43 ${w} ${theme}: card=${seen} text=${seen ? JSON.stringify((await card.innerText()).replace(/\s+/g, ' ').slice(0, 120)) : null}`);
      await snap(page, `pm43-could-not-verify-plan-${w}-${theme}`); expect.soft(seen).toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  }
});

test('#71 setup pill and the tour Example tag', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const a = await open(browser, w, h, theme, ROW);
    try {
      await gotoSignedIn(a.page, '/dashboard'); const pill = a.page.locator('.ob-checklist').first();
      const seen = await pill.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false); await a.page.waitForTimeout(4_000);
      console.log(`[PM] 71 pill ${w} ${theme}: shown=${seen} box=${JSON.stringify(seen ? await pill.boundingBox() : null)} text=${seen ? JSON.stringify((await pill.innerText()).replace(/\s+/g, ' ').slice(0, 80)) : null}`);
      await snap(a.page, `pm71-setup-pill-${w}-${theme}`); expect.soft(seen).toBe(true);
    } finally { await a.ctx.close().catch(() => {}); }
    const b = await open(browser, w, h, theme, { ...ROW, tour_seen: false });
    try {
      await gotoSignedIn(b.page, '/dashboard'); const dialog = b.page.locator('.tour-term-wrap[role="dialog"]');
      const opened = await dialog.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
      let found = false; let step = 1;
      for (; opened && step <= 8; step++) {
        if (await dialog.getByText('Example', { exact: true }).isVisible().catch(() => false)) { found = true; break; }
        const next = dialog.getByRole('button', { name: /next|continue|→/i }).last(); if (!(await next.isVisible().catch(() => false))) break; await next.click(); await b.page.waitForTimeout(1_500);
      }
      if (found) await b.page.waitForTimeout(4_000);
      console.log(`[PM] 71 tour ${w} ${theme}: opened=${opened} exampleTag=${found} onStep=${found ? step : null}`);
      await snap(b.page, `pm71-tour-example-tag-${w}-${theme}`); expect.soft(found).toBe(true);
    } finally { await b.ctx.close().catch(() => {}); }
  }
});

test('#72 onboarding wizard keyboard focus', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const { ctx, page } = await open(browser, w, h, theme, { ...ROW, tour_seen: false, profile_complete: false });
    try {
      await gotoSignedIn(page, '/dashboard'); const first = page.locator('[class*="obw-"]').first();
      const shown = await first.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false); await page.waitForTimeout(2_500);
      let focus: unknown = null;
      for (let i = 0; shown && i < 30; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(150);
        focus = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || !e.closest('[class*="obw"]')) return null; const s = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), label: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').slice(0, 40), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, shadow: s.boxShadow.slice(0, 60), border: s.borderColor }; });
        if (focus) break;
      }
      await page.waitForTimeout(500);
      console.log(`[PM] 72 ${w} ${theme}: wizard=${shown} firstFocus=${JSON.stringify(focus)}`);
      await snap(page, `pm72-wizard-focus-${w}-${theme}`); expect.soft(focus).not.toBeNull();
    } finally { await ctx.close().catch(() => {}); }
  }
});

for (const coin of ['pepe', 'btc'] as const) {
  test(`#62 liquidation bands ${coin}`, async ({ browser }) => {
    test.skip(!AUTH_READY, 'no fixtures');
    for (const [w, h] of SIZES) for (const theme of THEMES) {
      const { ctx, page } = await open(browser, w, h, theme, null);
      try {
        await gotoSignedIn(page, `/arena?coin=${coin}`); const host = page.locator('.klc-canvas').first(); await host.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(25_000);
        const chips = await page.locator('button.klc-tool-btn[aria-pressed]').evaluateAll((e) => e.map((x) => `${(x as HTMLElement).innerText.trim()}=${x.getAttribute('aria-pressed')}`));
        await host.scrollIntoViewIfNeeded(); await page.waitForTimeout(1_500);
        console.log(`[PM] 62 ${coin} ${w} ${theme}: chart title=${JSON.stringify((await page.title()).slice(0, 60))} toggles=${JSON.stringify(chips)}`);
        await snap(page, `pm62-liq-bands-${coin}-${w}-${theme}`); await host.screenshot({ path: `qa/.shots/pm62-liq-bands-${coin}-chart-${w}-${theme}.png` });
      } finally { await ctx.close().catch(() => {}); }
    }
  });
}
