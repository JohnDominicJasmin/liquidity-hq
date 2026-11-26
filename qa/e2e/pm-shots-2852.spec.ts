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
  }
  const page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page, stubbed };
}
const ROW = { tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false };

test('#70 page not found text', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/qa-no-such-page', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(6_000);
    console.log(`[PM] 70 text: ${JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 220))}`);
  } finally { await ctx.close().catch(() => {}); }
});

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
      await page.locator('.obw-skip').first().click({ timeout: 20_000 });
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

async function midPrice(coin: 'pepe' | 'btc') {
  const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }) });
  const mids = await r.json() as Record<string, string>; const v = Number(mids[coin === 'pepe' ? 'kPEPE' : 'BTC']); expect(v, 'live price').toBeGreaterThan(0); return v;
}
/* Ten price zones within 3.5 % of the price, 600 events over the last 20 h, newest first as the app reads them. Prices are in the unit the venue's symbol uses (PEPE: per 1000). */
function busyDay(coin: string, mid: number) {
  const now = Date.now(); const offsets = [-3.1, -2.2, -1.4, -0.7, -0.25, 0.3, 0.9, 1.7, 2.6, 3.4];
  return Array.from({ length: 600 }, (_, i) => { const k = i % offsets.length; const jitter = (((i * 37) % 11) - 5) / 5000;
    return { coin, side: offsets[k] < 0 ? 'LONG' : 'SHORT', usd: 15_000 + ((i * 7919) % 97) * 9_000 + k * 20_000, price: mid * (1 + offsets[k] / 100 + jitter), source: 'BB', ts: now - 60_000 - i * 120_000 }; });
}
for (const coin of ['pepe', 'btc'] as const) {
  test(`#62 liquidation bands ${coin}`, async ({ browser }) => {
    test.skip(!AUTH_READY, 'no fixtures');
    const mid = await midPrice(coin); const rows = busyDay(coin.toUpperCase(), mid);
    for (const [w, h] of SIZES) for (const theme of THEMES) {
      const { ctx, page } = await open(browser, w, h, theme, null);
      try {
        let served = 0;
        await ctx.route(/\/rest\/v1\/lhq(_dev)?_liq_events\?/, async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const url = decodeURIComponent(route.request().url()); const first = !/offset=[1-9]/.test(url); const wanted = !url.includes('coin=in.') || url.includes(coin.toUpperCase());
          const body = first && wanted ? rows : []; served += body.length;
          await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
        });
        await gotoSignedIn(page, `/arena?coin=${coin}`); const host = page.locator('.klc-canvas').first(); await host.waitFor({ state: 'visible', timeout: 90_000 });
        const liq = page.locator('button.klc-tool-btn[aria-pressed]').filter({ hasText: /liq/i }).first();
        const drawn = await liq.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false); await page.waitForTimeout(6_000);
        await host.scrollIntoViewIfNeeded(); await page.waitForTimeout(1_500);
        console.log(`[PM] 62 ${coin} ${w} ${theme}: price=${mid} testRowsServed=${served} liqToggle=${drawn ? await liq.getAttribute('aria-pressed') : 'absent'}`);
        await snap(page, `pm62-liq-bands-${coin}-testdata-${w}-${theme}`); await host.screenshot({ path: `qa/.shots/pm62-liq-bands-${coin}-testdata-chart-${w}-${theme}.png` }); expect.soft(drawn).toBe(true);
      } finally { await ctx.close().catch(() => {}); }
    }
  });
}
