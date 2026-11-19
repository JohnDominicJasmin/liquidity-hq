/* PROBE (QA, 2026-11-20): where do the remaining signed-out dash hits of the sweep come from (/about, /scanner, /liq)? Uses the sweep's own rule: a visible text node whose trimmed text is exactly one of - – — … ; prints the parent tag, its classes and the parent's outerHTML plus its parent's, so the node can be named. Read-only. */
import { test } from '@playwright/test';

for (const path of ['/about', '/scanner', '/liq']) {
  test(`probe dashes ${path}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(20_000);
    const rows = await page.evaluate(() => {
      const out: string[] = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const p = n.parentElement; if (!p) continue; const t = (n.textContent || '').replace(/\s+/g, ' ').trim(); if (!/^(—|–|--|-|…|\.\.\.)$/.test(t)) continue;
        const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); if (!(r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden')) continue;
        const gp = p.parentElement; out.push(`<${p.tagName.toLowerCase()} class="${String((p as HTMLElement).className).slice(0, 50)}"> text "${t}" | parent: ${(p.outerHTML || '').slice(0, 140).replace(/\s+/g, ' ')} | grandparent: ${(gp?.outerHTML || '').slice(0, 220).replace(/\s+/g, ' ')} | nearby text: "${(gp?.innerText || '').replace(/\s+/g, ' ').slice(0, 90)}"`);
      }
      return out;
    });
    console.log(`[DASH] ${path}: ${rows.length} nodes`); for (const r of rows.slice(0, 8)) console.log(`[DASH]   ${r}`);
  });
}
