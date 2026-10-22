/* Signed-OUT screenshots of /upgrade on qa: light and dark, desktop and phone.
 * A fresh browser context has no session, so signed-out is by construction; the script also records the
 * final URL (a redirect to /arena would mean it was NOT signed out) and the visible price and button text.
 * The theme is set the way the app reads it (localStorage 'theme'), and the applied data-theme is logged. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const HOST = process.argv[2] ?? 'https://liquidity-hq-qa.onrender.com';
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: 'desktop', viewport: { width: 1280, height: 900 }, isMobile: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true },
];
const THEMES = ['light', 'dark'];

const version = await (await fetch(`${HOST}/api/version`, { cache: 'no-store' })).json();
console.log(`captured against ${HOST} commit ${String(version.commit).slice(0, 7)} branch ${version.branch}`);

const browser = await chromium.launch();
for (const v of VIEWS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: v.viewport,
      isMobile: v.isMobile,
      hasTouch: v.isMobile,
      deviceScaleFactor: v.isMobile ? 2 : 1,
      colorScheme: theme,
    });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* storage blocked */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${HOST}/upgrade`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    // the labels arrive from /api/labels after hydration: wait for a price to be on the page rather than a fixed sleep
    let priced = true;
    try { await page.getByText('$35', { exact: false }).first().waitFor({ timeout: 45_000 }); } catch { priced = false; }
    await page.waitForTimeout(1500);
    // the cookie banner is fixed to the bottom of the viewport and would cover the plan buttons: decline it (fresh context, no effect on anyone)
    const decline = page.getByRole('button', { name: 'Decline' });
    if (await decline.count()) { await decline.first().click(); await page.waitForTimeout(600); }
    // phone: what a visitor really sees while scrolling, fixed bars included
    if (v.isMobile) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let n = 0, y = 0; y < h && n < 4; n++, y += v.viewport.height - 60) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(400);
        await page.screenshot({ path: OUT + '/upgrade-qa-' + theme + '-phone-scroll-' + (n + 1) + '.png' });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // full-page capture: fixed bars (bottom nav, Ask AI, banner) would land in the MIDDLE of a stitched image, so hide them for the layout view
    await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'; } });
    const info = await page.evaluate(() => ({
      url: location.href,
      theme: document.documentElement.getAttribute('data-theme'),
      text: document.body.innerText,
    }));
    const lines = info.text.split('\n').map((s) => s.trim()).filter(Boolean);
    const interesting = lines.filter((l) => /\$\d|coming soon|Get Pro|2 months|billed|per month|\/mo|\/2|\/yr|weeks/i.test(l));
    const file = `${OUT}/upgrade-qa-${theme}-${v.name}-fullpage.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${theme}/${v.name}: url=${info.url} data-theme=${info.theme} priced=${priced}`);
    console.log(`   visible price/button lines: ${JSON.stringify(interesting).slice(0, 700)}`);
    console.log(`   saved ${file}`);
    await ctx.close();
  }
}
await browser.close();
