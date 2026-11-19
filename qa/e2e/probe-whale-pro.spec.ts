/* PROBE (QA, 2026-11-20): the "-" under Whale Trades on /liq for a Pro account at 1280. Prints every element whose own text is "-", "–" or "Unavailable" with its tag, classes, testid, labelled ancestor text and outerHTML. Read-only. */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const path of ['/liq', '/arena?coin=btc']) {
  test(`probe pro text nodes ${path}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await gotoSignedIn(page, path); await page.waitForTimeout(25_000);
      const rows = await page.evaluate(() => {
        const bad = /^(unavailable|-|–|no data)$/i; const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || '').trim()).join(' ').trim();
          if (!bad.test(own)) continue;
          const r = (el as HTMLElement).getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
          let anc: HTMLElement | null = el.parentElement; let ctx = ''; for (let i = 0; i < 6 && anc; i++, anc = anc.parentElement) { const t = (anc.innerText || '').replace(/\s+/g, ' ').trim(); if (t.length > own.length + 12) { ctx = t.slice(0, 120); break; } }
          const tid = el.closest('[data-testid]')?.getAttribute('data-testid') || '';
          out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className?.toString().slice(0, 50)} own="${own}" testid=${tid} ctx="${ctx}" html=${el.outerHTML.slice(0, 170)}`);
        }
        return out;
      });
      console.log(`[PROBE] pro ${path}: ${rows.length} nodes`); for (const r of rows.slice(0, 14)) console.log(`[PROBE]   ${r}`);
    } finally { await ctx.close().catch(() => {}); }
  });
}
