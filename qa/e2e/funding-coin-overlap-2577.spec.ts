/* #2577 /funding: the coin cell's button spilled over the rate column (text-under-control found 5+ rate cells "tappable as button.frh-coin-btn (at its left edge)" after #2555 added the "Bybit" tag beside a coin name).
 *   FO1  at 390 / 768 / 1280, light and dark, signed out: for every rate/average cell with text in the funding table, the element at the cell's left edge and centre is NOT the coin button (no overlap); the coin button's right edge is inside its own cell; at least 5 rows with a Bybit tag or a coin button were measured (CONTROL: the table rendered)
 *   FO2  no sideways scroll on /funding at those widths (document width = viewport)
 * Shots: qa/.shots/funding-<w>-<theme>.png. Signed out, read-only. Run on a CI-built ref of the PR and on dev as the CONTROL (dev must show overlaps). */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });
for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280]) {
  test(`FO ${width} ${theme}: no rate cell sits under a coin button, and the page does not scroll sideways`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
    const page = await ctx.newPage();
    try {
      await page.goto('/funding', { waitUntil: 'domcontentloaded' });
      await expect.poll(async () => page.evaluate(() => document.querySelectorAll('.frh-table .frh-row').length), { timeout: 60_000, message: 'CONTROL: the funding table never rendered' }).toBeGreaterThanOrEqual(5);
      await page.waitForTimeout(8_000);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth; const rows = Array.from(document.querySelectorAll('.frh-table .frh-row')) as HTMLElement[];
        const over: string[] = []; let measured = 0, tags = 0, spill = 0;
        for (const r of rows) {
          const tds = Array.from(r.querySelectorAll('td')) as HTMLElement[]; const btn = r.querySelector('.frh-coin-btn') as HTMLElement | null; if (!btn || tds.length < 2) continue;
          if (r.querySelector('[data-testid="funding-venue-bybit"]')) tags++;
          const bb = btn.getBoundingClientRect(), c0 = tds[0].getBoundingClientRect(); if (bb.right > c0.right + 1) spill++;
          for (const td of tds.slice(1, 3)) {
            const t = (td.innerText || '').trim(); if (!t) continue; const rect = td.getBoundingClientRect(); if (rect.width < 2) continue; measured++;
            for (const x of [rect.left + 2, rect.left + rect.width / 2]) { const hit = document.elementFromPoint(x, rect.top + rect.height / 2); if (hit && (hit.closest('.frh-coin-btn'))) { over.push(`"${t.slice(0, 10)}" at x=${Math.round(x - rect.left)} under .frh-coin-btn`); break; } }
          }
        }
        return { vw, doc: document.documentElement.scrollWidth, rows: rows.length, measured, tags, spill, over: over.slice(0, 8), nOver: over.length };
      });
      console.log(`[FO] ${width} ${theme} ${JSON.stringify(m)}`);
      await page.screenshot({ path: `qa/.shots/funding-${width}-${theme}.png`, fullPage: false }).catch(() => {});
      expect(m.measured, 'CONTROL: no rate cell was measured').toBeGreaterThan(4);
      expect(m.over, `rate cells sit under the coin button (${m.nOver}): ${m.over.join(' | ')}`).toEqual([]);
      expect(m.spill, 'a coin button is wider than its own cell').toBe(0);
      expect(m.doc, `/funding is ${m.doc}px wide at ${m.vw}`).toBeLessThanOrEqual(m.vw);
    } finally { await ctx.close(); }
  });
}
