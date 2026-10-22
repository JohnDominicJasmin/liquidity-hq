/* Does the not-found page throw a hydration error (React #418), and is that new with #1434?
 * Signed out, no session, allowlist: only the app's own host; everything else aborted; sockets closed.
 * usage: node check-notfound-hydration.mjs <base>... */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
try {
  for (const base of process.argv.slice(2)) {
    const BASE = base.replace(/\/$/, '');
    const host = new URL(BASE).host;
    const v = await (await fetch(BASE + '/api/version')).json();
    for (const path of ['/zz-not-a-page', '/ar', '/faq']) {
      for (let i = 0; i < 2; i++) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const blocked = new Set();
        await ctx.routeWebSocket(/.*/, (ws) => ws.close());
        await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.host === host || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue(); blocked.add(u.host); return r.abort('failed'); });
        const page = await ctx.newPage();
        const errors = [];
        const consoleErrors = [];
        page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
        const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 }).catch(() => null);
        const serverText = res ? (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260) : null;
        await page.waitForTimeout(3000);
        const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 260));
        console.log(JSON.stringify({ host, commit: v.commit, path, run: i + 1, status: res?.status() ?? null, pageErrors: errors, consoleErrors: consoleErrors.filter((t) => !/ERR_FAILED|Failed to load resource|WebSocket/.test(t)).slice(0, 3), serverText, shown, blockedHosts: [...blocked] }));
        await ctx.close();
      }
    }
  }
} finally { await browser.close(); }
