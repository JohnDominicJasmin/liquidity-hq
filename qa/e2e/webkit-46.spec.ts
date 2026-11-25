/* QA #1185 owner item 46 on a deployed site: the main pages in WebKit (the engine of Safari and every iPhone browser) beside Chromium on the same device profiles. Playwright's WebKit is not Apple's Safari or a real iPhone: this
 * catches engine differences, not device ones. Dispatch-only (the workflow of this ref installs WebKit). GETs only, writes stubbed by nobody because nothing is clicked that writes; the AI is fenced. Prints [W46] lines. */
import { test, devices, type Browser, type BrowserContext } from '@playwright/test';
import { AUTH_READY, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 240_000, retries: 0 });
const OUT = ['/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/correlation', '/news', '/econ-calendar', '/calc', '/hours', '/upgrade', '/login', '/learn', '/faq'];
const PROFILES = [['iphone', 'iPhone 13'], ['desktop', 'Desktop Safari']] as const;
/* WebKit did not answer the site gate through httpCredentials (run 45665110409): the team password is added by hand, to this site's own origin only, and only where the request carries no authorization of its own. */
async function throughGate(ctx: BrowserContext) {
  const password = process.env.SITE_GATE_PASSWORD; if (!password) return;
  const origin = new URL(process.env.E2E_BASE_URL as string).origin; const basic = `Basic ${Buffer.from(`team:${password}`).toString('base64')}`;
  await ctx.route((u) => u.origin === origin, async (route) => { const h = await route.request().allHeaders(); if (!h.authorization) h.authorization = basic; await route.continue({ headers: h }); });
}
const gate = () => (process.env.SITE_GATE_PASSWORD ? { httpCredentials: { username: 'team', password: process.env.SITE_GATE_PASSWORD, origin: new URL(process.env.E2E_BASE_URL as string).origin } } : {});

async function visit(ctx: BrowserContext, tag: string, path: string, shot: boolean) {
  const page = await ctx.newPage(); const errors: string[] = [], bad: string[] = [], consoleErrors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|451|status of 4(01|03|29)|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text().slice(0, 140)); });
  page.on('response', (r) => { if (r.status() >= 500 && new URL(r.url()).pathname.startsWith('/api/')) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  try {
    await installPaidAiFence(page);
    const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(16_000);
    const m = await page.evaluate(() => { const main = document.querySelector('main') ?? document.body; const w = document.documentElement.clientWidth; const wide = Array.from(document.querySelectorAll('main *')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 2 && !e.closest('[style*="overflow"],.table-scroll,.scroll-x,table'); }).length; return { chars: (main.innerText || '').length, scrollWidth: document.documentElement.scrollWidth, width: w, wide, canvases: Array.from(document.querySelectorAll('canvas')).filter((c) => c.getBoundingClientRect().width > 100 && c.getBoundingClientRect().height > 60).length, text: (main.innerText || '').replace(/\s+/g, ' ').slice(0, 90), nan: (document.body.innerText.match(/\bNaN\b|Invalid Date|undefined/g) ?? []).slice(0, 4) }; });
    let menu: string | null = null;
    if (tag.includes('iphone') && path === '/dashboard') { const b = page.getByRole('button', { name: /open navigation menu/i }).first(); await b.tap().catch(async () => { await b.click(); }); await page.waitForTimeout(1_200); const open = await page.locator('[role="dialog"][aria-hidden="false"], [role="dialog"]:not([inert])').count(); menu = open > 0 ? 'opens' : 'did not open'; }
    console.log(`[W46] ${tag} ${path}: status=${res?.status()} ${JSON.stringify(m)}${menu ? ` menu=${menu}` : ''} pageErrors=${JSON.stringify(errors.slice(0, 3))} console=${JSON.stringify([...new Set(consoleErrors)].slice(0, 3))} api5xx=${JSON.stringify([...new Set(bad)].slice(0, 3))}`);
    if (shot) await page.screenshot({ path: `qa/.shots/w46-${tag.replace(/\s+/g, '-')}${path.replace(/\//g, '_') || '_home'}.png` });
  } catch (e) { console.log(`[W46] ${tag} ${path}: FAILED ${String((e as Error).message).slice(0, 200)}`); } finally { await page.close().catch(() => {}); }
}

for (const engine of ['webkit'] as const) for (const [profile, device] of PROFILES) {
  test(`${engine} ${profile} signed out`, async ({ playwright }) => {
    test.setTimeout(600_000);
    const browser: Browser = await playwright[engine].launch();
    try {
      const { defaultBrowserType: _ignored, ...d } = devices[device];
      const ctx = await browser.newContext({ ...d, baseURL: process.env.E2E_BASE_URL, ...gate() });
      await throughGate(ctx);
      await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      console.log(`[W46] ${engine} ${profile}: version ${browser.version()}`);
      for (const path of OUT) await visit(ctx, `${engine} ${profile}`, path, engine === 'webkit' && ['/', '/dashboard', '/arena', '/liq'].includes(path));
      await ctx.close();
    } finally { await browser.close().catch(() => {}); }
  });
}

test('webkit iphone signed in', async ({ playwright }) => {
  test.skip(!AUTH_READY, 'no fixtures'); test.setTimeout(600_000);
  const browser: Browser = await playwright.webkit.launch();
  try {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 }, theme: 'dark' });
    await throughGate(ctx);
    for (const path of ['/dashboard', '/arena', '/alerts', '/settings', '/journal']) await visit(ctx, 'webkit iphone-pro', path, false);
    await ctx.close();
  } catch (e) { console.log(`[W46] webkit signed in FAILED ${String((e as Error).message).slice(0, 220)}`); } finally { await browser.close().catch(() => {}); }
});
