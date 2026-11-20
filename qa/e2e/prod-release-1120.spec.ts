/* PROD, READ-ONLY, SIGNED OUT (QA 2026-11-19, release v2026.11.20 live as main 621850d): GETs only, nothing is written, no sign-in, no AI. Run through the prod sweep ref (the production guard allowlists it).
 *   R1 /upgrade and the landing Pricing card show the three Pro rows the release shipped (16 strategies, Quick and Deep use strategy settings, Telegram alerts with quiet hours / snooze / mute), at 390 and 1280
 *   R2 /markets at 390 and 1280: no "No data" / "undefined" / "NaN" in the table text and the blank-cell count is printed (#2627: a missing cell is blank, never a placeholder word)
 *   R3 /hours: the page title is "Trading Sessions" (not "Best Hours"), no segment says DEAD, and no "God Tier" / "Dead Zone" / "Prime" anywhere (#1113)
 *   R4 prod is not gated and not hidden: no Basic challenge, no X-Robots-Tag noindex, robots.txt does not disallow everything, /api/version answers, an unknown path is a real 404
 *   R5 a plain sweep of the main pages at 390 and 1280: HTTP 200, no horizontal overflow beyond the viewport, no console error */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });
const V = (tag: string, msg: string) => console.log(`[PR] ${tag} ${msg}`);
const open = async (browser: import('@playwright/test').Browser, width: number) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private mode */ } });
  return { ctx, page };
};
const body = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const goto = async (page: Page, path: string) => { const r = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(4_000); return r; };

for (const width of [390, 1280]) {
  test(`R1 /upgrade and the landing Pricing card at ${width}: the three Pro rows`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width);
    try {
      const want = ['16 strategies on every coin', 'Quick and Deep reads use your strategy and indicator settings', 'Telegram alerts: all signal types, quiet hours, snooze, mute by type'];
      for (const path of ['/upgrade', '/']) {
        await goto(page, path); if (path === '/') await page.evaluate(() => document.getElementById('pricing')?.scrollIntoView()); await page.waitForTimeout(1_500);
        const text = await body(page); const missing = want.filter((w) => !text.includes(w)); V('R1', `${path} ${width}: missing ${JSON.stringify(missing)}`);
        await page.screenshot({ path: `qa/.shots/pr-${path === '/' ? 'landing' : 'upgrade'}-${width}.png`, fullPage: false }).catch(() => {});
        expect(missing, `${path} at ${width} does not show the Pro rows of this release`).toEqual([]);
      }
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`R2 /markets at ${width}: no placeholder words in the table`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width);
    try {
      await goto(page, '/markets'); await page.waitForTimeout(8_000);
      const text = await body(page); const bad = [...text.matchAll(/no data|\bundefined\b|\bNaN\b|\[object/g)].map((m) => m[0]);
      const blanks = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="mkt-price"], [class*="mkt-buy"], [class*="mkt-pressure"]')).filter((e) => !(e.textContent || '').trim()).length);
      V('R2', `/markets ${width}: ${text.length} chars · placeholder words ${JSON.stringify(bad)} · blank price/pressure cells ${blanks}`);
      await page.screenshot({ path: `qa/.shots/pr-markets-${width}.png` }).catch(() => {});
      expect(text.length, '/markets rendered almost nothing').toBeGreaterThan(500); expect(bad, 'placeholder words on /markets').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`R3 /hours at ${width}: Trading Sessions, plain window names, no DEAD`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width);
    try {
      await goto(page, '/hours'); const m = await page.evaluate(() => ({ h1: (document.querySelector('h1')?.textContent || '').trim(), dead: Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^dead$/i.test((e.textContent || '').trim())).length }));
      const text = await body(page); const old = /God Tier|Dead Zone|\bPrime\b/.exec(text);
      V('R3', `/hours ${width}: h1 "${m.h1}" · DEAD labels ${m.dead} · old window names ${old ? old[0] : 'none'}`); await page.screenshot({ path: `qa/.shots/pr-hours-${width}.png` }).catch(() => {});
      expect(m.h1, 'the /hours title is still the advice wording').toMatch(/trading sessions/i); expect(m.h1).not.toMatch(/best hours/i); expect(m.dead, 'a segment still says DEAD').toBe(0); expect(old, `an old window name is on /hours: ${old?.[0]}`).toBeNull();
    } finally { await ctx.close().catch(() => {}); }
  });
}
test('R4 prod is not gated, not hidden, and 404s a missing page', async ({ request }) => {
  const root = await request.get('/', { maxRedirects: 3 }); const h = root.headers(); const robots = await request.get('/robots.txt'); const ver = await request.get('/api/version'); const nf = await request.get('/this-page-does-not-exist-qa-1120');
  const rt = (await robots.text()).replace(/\s+/g, ' ');
  V('R4', `/ ${root.status()} www-authenticate ${h['www-authenticate'] ?? 'none'} x-robots-tag ${h['x-robots-tag'] ?? 'none'} · robots.txt ${robots.status()} "${rt.slice(0, 90)}" · /api/version ${ver.status()} ${(await ver.text()).slice(0, 60)} · missing page ${nf.status()}`);
  expect(root.status()).toBe(200); expect(h['www-authenticate'], 'prod must not challenge for a password').toBeUndefined(); expect(h['x-robots-tag'] ?? '', 'prod must not be noindex').not.toMatch(/noindex/i);
  expect(robots.status()).toBe(200); expect(rt, 'robots.txt disallows everything').not.toMatch(/Disallow:\s*\/\s*($|User-agent)/i); expect(ver.status()).toBe(200); expect(nf.status(), 'an unknown path must be a real 404').toBe(404);
});
for (const width of [390, 1280]) for (const path of ['/', '/dashboard', '/arena?coin=btc', '/research', '/markets', '/briefing', '/hours', '/upgrade', '/scanner', '/funding', '/liq', '/news', '/correlation']) {
  test(`R5 ${path} ${width}: 200, no sideways overflow, no console error`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width); const errs: string[] = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); }); page.on('pageerror', (e) => errs.push(`pageerror ${String(e).slice(0, 120)}`));
    try {
      const r = await goto(page, path); await page.waitForTimeout(3_000); const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      const real = errs.filter((e) => !/favicon|analytics|WebSocket connection to|Failed to load resource: the server responded with a status of (401|403|429)|net::ERR_(BLOCKED|FAILED)/i.test(e));
      V('R5', `${path} ${width}: HTTP ${r?.status()} · scrollWidth ${ov.sw} vs ${ov.iw} · console errors ${JSON.stringify(real.slice(0, 3))}`);
      expect(r?.status()).toBe(200); expect(ov.sw, `sideways overflow: scrollWidth ${ov.sw} > ${ov.iw}`).toBeLessThanOrEqual(ov.iw + 1); expect(real, 'console errors').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
