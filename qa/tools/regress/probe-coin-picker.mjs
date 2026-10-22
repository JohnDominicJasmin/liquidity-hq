/* The buttons pass timed out clicking "BTC ▾" on 23 pages (its call log was cut short at record time, so "hidden" and "covered" could not be told
 * apart). This opens /dashboard and /arena as Pro A at 1280 and 390 and, for every "BTC ▾" and "▼ Below" control: is it visible, what element sits at
 * its centre, does a normal click succeed, and does anything new appear. Reads only. usage: node probe-coin-picker.mjs                               */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { appendFileSync } from 'node:fs';
const browser = await chromium.launch();
try {
  const build = (await (await fetch(BASE + '/api/version')).json()).commit;
  for (const [path, w] of [['/dashboard', 1280], ['/dashboard', 390], ['/arena', 1280]]) {
    const ctx = await open(browser, { acct: 'A', w, theme: 'dark', rec: [] }); const page = await ctx.newPage(); const inflight = new Map();
    page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(2000);
    for (const re of [/^BTC\s*▾$/, /^▼\s*Below$/]) {
      const all = page.locator('button, [role="button"]').filter({ hasText: re });
      const n = await all.count(); const items = [];
      for (let i = 0; i < n; i++) {
        const el = all.nth(i);
        const info = await el.evaluate((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const top = r.width && r.height && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
          return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], display: cs.display, visibility: cs.visibility, opacity: cs.opacity, ariaHidden: e.closest('[aria-hidden="true"]') ? true : false,
            coveredBy: top && top !== e && !e.contains(top) ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 50)}` : null }; });
        const before = await page.evaluate(() => document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[role="menuitem"],[role="option"]').length);
        let clicked = 'ok'; await el.click({ timeout: 4000 }).catch((e) => { clicked = String(e.message).split('\n').slice(0, 4).join(' / ').slice(0, 260); });
        await sleep(800);
        const after = await page.evaluate(() => document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[role="menuitem"],[role="option"]').length);
        items.push({ i, ...info, clicked, popupElementsBefore: before, popupElementsAfter: after });
        await page.keyboard.press('Escape').catch(() => {}); await sleep(300);
      }
      const row = { at: new Date().toISOString(), part: 'probe-coin-picker', build, path, w, control: String(re), count: n, items };
      console.log(JSON.stringify(row)); appendFileSync(`${ROOT}/_sweep/buttons.jsonl`, JSON.stringify(row) + '\n');
    }
    await ctx.close();
  }
} finally { await browser.close(); }
