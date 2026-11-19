/* PROBE (QA, 2026-11-20): where do the failing-text sweep hits come from? Prints, for a few pages signed out at 1280, every element whose OWN text is exactly "Unavailable", "-" or "–" (or "No data"), with its tag, classes, data-testid, the nearest labelled ancestor text and a short outerHTML. Read-only. */
import { test } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

const PAGES = ['/dashboard', '/liq', '/arena?coin=btc'];
for (const path of PAGES) {
  test(`probe text nodes ${path}`, async ({ page }) => {
    test.setTimeout(120_000);
    await installPaidAiFence(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(25_000);
    const rows = await page.evaluate(() => {
      const bad = /^(unavailable|-|–|no data)$/i; const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || '').trim()).join(' ').trim();
        if (!bad.test(own)) continue;
        const r = (el as HTMLElement).getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
        let anc: HTMLElement | null = el.parentElement; let ctx = ''; for (let i = 0; i < 6 && anc; i++, anc = anc.parentElement) { const t = (anc.innerText || '').replace(/\s+/g, ' ').trim(); if (t.length > own.length + 12) { ctx = t.slice(0, 110); break; } }
        const tid = el.closest('[data-testid]')?.getAttribute('data-testid') || '';
        out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className?.toString().slice(0, 50)} own="${own}" testid=${tid} ctx="${ctx}" html=${el.outerHTML.slice(0, 160)}`);
      }
      return out;
    });
    console.log(`[PROBE] ${path}: ${rows.length} nodes`); for (const r of rows.slice(0, 14)) console.log(`[PROBE]   ${r}`);
  });
}
