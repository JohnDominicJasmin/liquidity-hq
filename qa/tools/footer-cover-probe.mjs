/* Is a footer link covered by the fixed mobile tab bar? The layout spec flagged /journal and /news on staging
 * (the release candidate). This asks the SAME question of production (the previous release) so the finding can be
 * told apart: new in the candidate, or already there. Read-only: public pages, one fresh headless browser, no
 * session, nothing written. Scrolled to the bottom, then elementFromPoint at each footer link's centre. */
import { chromium } from 'playwright';

const HOSTS = process.argv.slice(2);
const PAGES = ['/news', '/journal', '/faq', '/about'];
const browser = await chromium.launch();
for (const host of HOSTS) {
  for (const path of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* blocked */ } });
    const page = await ctx.newPage();
    try {
      await page.goto(`https://${host}${path}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForTimeout(6000);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const bar = document.querySelector('nav.tnav-tabs');
        const barTop = bar ? bar.getBoundingClientRect().top : null;
        const links = [...document.querySelectorAll('a.pf-footer-link')].map((a) => {
          const b = a.getBoundingClientRect();
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return { text: (a.textContent || '').trim().slice(0, 18), top: Math.round(b.top), bottom: Math.round(b.bottom), covered: !!(hit && hit !== a && !a.contains(hit) && hit.closest('nav.tnav-tabs')) };
        });
        return { barTop: barTop === null ? null : Math.round(barTop), viewport: innerHeight, url: location.pathname, links };
      });
      const covered = r.links.filter((l) => l.covered);
      console.log(`${host} ${path}: landed ${r.url}; tab bar top=${r.barTop} of ${r.viewport}; footer links ${r.links.length}, covered by the tab bar ${covered.length}${covered.length ? ' (' + covered.map((l) => `${l.text}@${l.top}-${l.bottom}`).join(', ') + ')' : ''}`);
    } catch (e) {
      console.log(`${host} ${path}: PROBE FAILED ${String(e.message).slice(0, 100)}`);
    }
    await ctx.close();
  }
}
await browser.close();
