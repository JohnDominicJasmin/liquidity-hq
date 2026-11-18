/* #2606 THE LANDING IS FULL-BLEED FROM THE FIRST PAINT (the CLS hold: at 390 the landing root jumped [16,70,358,774] -> [0,0,390,844] at ~1.5 s = +0.128).
 *   LB1  /, /ko, /zh, /ru at 390 and 1280, dark and light, signed out: html has data-landing from the first frame (read in an init script at DOMContentLoaded), the layout-shift total of the load is at most 0.1, NO shift entry moves div.lpt-root by more than 4 px, and the root ends at x=0 and the full viewport width.
 *   LB2  signed in (Pro fixture) on /: a signed-in user is not shown the landing (the app renders), the load shifts at most 0.1 and nothing named lpt-root moves, at 390 and 1280.
 *   LB3  client-side navigation: from / click a link to an app route (Next Link, no reload): data-landing is REMOVED and the app shell shows (the body is no longer .landing and the padded frame is back); browser Back to /: the landing again, data-landing set, the root full-bleed.
 * Shots: qa/.shots/landing-<path>-<w>-<theme>.png. Read-only. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

mkdirSync('qa/.shots', { recursive: true });
const INIT = () => {
  const w = window as unknown as { __cls: number; __moves: string[]; __landingAtDcl: boolean | null };
  w.__cls = 0; w.__moves = []; w.__landingAtDcl = null;
  document.addEventListener('DOMContentLoaded', () => { w.__landingAtDcl = document.documentElement.hasAttribute('data-landing'); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) { if (!e.hadRecentInput) w.__cls += e.value; for (const s of e.sources || []) { const el = s.node && (s.node.nodeType === 1 ? (s.node as HTMLElement) : s.node.parentElement); if (el && el.classList && el.classList.contains('lpt-root')) { const d = Math.max(Math.abs(s.previousRect.x - s.currentRect.x), Math.abs(s.previousRect.y - s.currentRect.y), Math.abs(s.previousRect.width - s.currentRect.width)); if (d > 4) w.__moves.push(`[${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)},${Math.round(s.previousRect.width)},${Math.round(s.previousRect.height)}]->[${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)},${Math.round(s.currentRect.width)},${Math.round(s.currentRect.height)}]`); } } } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
};
const facts = (page: Page) => page.evaluate(() => { const w = window as unknown as { __cls: number; __moves: string[]; __landingAtDcl: boolean | null }; const r = document.querySelector('.lpt-root')?.getBoundingClientRect(); return { cls: +w.__cls.toFixed(4), moves: w.__moves, atDcl: w.__landingAtDcl, now: document.documentElement.hasAttribute('data-landing'), root: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width)] : null, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, bodyLanding: document.body.classList.contains('landing') }; });

for (const path of ['/', '/ko', '/zh', '/ru']) for (const width of [390, 1280]) for (const theme of ['dark', 'light'] as const) {
  test(`LB1 ${path} ${width} ${theme}: full-bleed from the first paint, no root jump`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.addInitScript(INIT); await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(10_000); const f = await facts(page);
      console.log(`[LB] ${path} ${width} ${theme} ${JSON.stringify(f)}`);
      await page.screenshot({ path: `qa/.shots/landing-${path.replace(/\W/g, '') || 'root'}-${width}-${theme}.png` }).catch(() => {});
      expect(f.atDcl, `html[data-landing] was not set by DOMContentLoaded on ${path}`).toBe(true);
      expect(f.moves, `div.lpt-root moved during the load on ${path}`).toEqual([]);
      expect(f.root, 'CONTROL: the landing root is on the page').not.toBeNull(); expect(f.root![0], 'root x').toBe(0); expect(f.root![2], 'root width = the viewport').toBe(f.vw);
      expect(f.sw, `${path} scrolls sideways`).toBeLessThanOrEqual(f.vw);
      expect(f.cls, `layout shift of the load on ${path}`).toBeLessThanOrEqual(0.1);
    } finally { await ctx.close(); }
  });
}

for (const width of [390, 1280]) {
  test(`LB2 signed in / ${width}: the same`, async ({ browser }) => {
    test.setTimeout(150_000); test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); await ctx.addInitScript(INIT); const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/'); await page.waitForTimeout(10_000); const f = await facts(page); console.log(`[LB] signed-in / ${width} ${JSON.stringify(f)}`);
      expect(f.moves, 'the landing root moved during the load').toEqual([]); expect(f.cls, 'layout shift of a signed-in load of /').toBeLessThanOrEqual(0.1);   // a signed-in user is not shown the landing (root null, no data-landing): the cell asserts no shift, nothing about the frame
    } finally { await ctx.close(); }
  });
}

test('LB3 client-side navigation: landing -> app shows the shell; Back -> landing again', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(INIT); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000);
    const before = await facts(page); expect(before.now, 'landing has data-landing').toBe(true);
    await page.evaluate(() => { (window as unknown as { __noReload: number }).__noReload = 1; });
    const link = page.locator('a[href="/markets"], a[href="/dashboard"], a[href="/arena"], a[href="/news"]').first();
    await expect(link, 'CONTROL: the landing has a link to an app route').toBeVisible({ timeout: 30_000 }); await link.click();
    await page.waitForURL((u) => u.pathname !== '/', { timeout: 30_000 }); await page.waitForTimeout(3_000);
    const reloaded = await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload !== 1);
    const app = await facts(page); console.log(`[LB] after nav ${JSON.stringify(app)} reloaded=${reloaded}`);
    expect(reloaded, 'CONTROL: this must be a client-side navigation, not a reload').toBe(false);
    expect(app.now, 'data-landing must be removed after leaving the landing').toBe(false); expect(app.bodyLanding, 'body still has the landing class').toBe(false);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4_000);
    const back = await facts(page); console.log(`[LB] after back ${JSON.stringify(back)}`);
    expect(back.bodyLanding, 'Back to /: the landing is shown (body.landing)').toBe(true); expect(back.root?.[0], 'the landing root is full-bleed again').toBe(0); expect(back.root?.[2], 'full width').toBe(back.vw);   // data-landing is a first-paint aid: a client-side Back needs only the body class
  } finally { await ctx.close(); }
});
