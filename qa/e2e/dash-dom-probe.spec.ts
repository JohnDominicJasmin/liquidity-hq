/* WHAT ARE THE REMAINING DASHES? (owner order, "no failing data", staging 94de50b sweep): for every visible text node that is exactly a dash on /about, /dashboard, /scanner, /liq and /arena, print its parent element and the surrounding sentence, so each can be called a separator inside prose (fine) or a value placeholder (a data gap). Signed out, read-only. Prints [DASH] lines; asserts nothing. */
import { test } from '@playwright/test';

const PAGES = ['/about', '/dashboard', '/scanner', '/liq', '/arena?coin=btc'];
for (const path of PAGES) {
  test(`DASH ${path}`, async ({ browser }) => {
    test.setTimeout(120_000); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(22_000);
      const out = await page.evaluate(() => {
        const res: string[] = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = (n.textContent || '').trim(); if (!/^[-–—]$/.test(t)) continue; const el = n.parentElement; if (!el) continue; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
          const up = el.parentElement; const sib = up ? Array.from(up.children).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 22)).join(' | ') : '';
          res.push(`"${t}" in <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 30)}"> parent text: "${((up as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90)}" siblings: [${sib.slice(0, 120)}]`);
        }
        return res.slice(0, 8);
      });
      console.log(`[DASH] ${path}: ${JSON.stringify(out)}`);
    } finally { await ctx.close(); }
  });
}
