/* QA, for Dev: which text the support-address link reaches on /security and /accessibility (found by text-under-control). Read only, signed out. Prints [ML] lines. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 300_000, retries: 0 });
for (const [width, height] of [[390, 844], [1280, 720]] as const) {
  test(`mail link ${width}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      for (const path of ['/security', '/accessibility', '/contact']) {
        await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(8_000);
        const n = await page.locator('a.support-mail-link').count();
        for (let i = 0; i < n; i++) {
          const link = page.locator('a.support-mail-link').nth(i); await link.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
          const m = await link.evaluate((a) => {
            const box = (r: DOMRect) => [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10);
            const A = a.getBoundingClientRect(); const cs = getComputedStyle(a); const parent = a.parentElement!; const pcs = getComputedStyle(parent);
            const hits: Array<Record<string, unknown>> = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); /* every text on the page: the reached words sit in sibling blocks */
            for (let t = walker.nextNode(); t; t = walker.nextNode()) {
              const el = t.parentElement!; if (a.contains(el) || !t.textContent?.trim()) continue; const range = document.createRange(); range.selectNodeContents(t);
              for (const r of Array.from(range.getClientRects())) {
                const overlapX = Math.min(r.right, A.right) - Math.max(r.left, A.left), overlapY = Math.min(r.bottom, A.bottom) - Math.max(r.top, A.top);
                if (overlapX <= 0.5 || overlapY <= 0.05) continue;
                const tapped: number[] = []; for (const dy of [0.25, 0.5, 1, 1.5, 2, r.height / 2, r.height - 2, r.height - 1, r.height - 0.5]) { const x = Math.max(r.left, A.left) + overlapX / 2, y = r.top + dy; if (document.elementFromPoint(x, y)?.closest('a') === a) tapped.push(Math.round(dy * 10) / 10); }
                hits.push({ element: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''), text: t.textContent!.replace(/\s+/g, ' ').trim().slice(0, 50), line: box(r), overlap: [Math.round(overlapX), Math.round(overlapY * 10) / 10], tapAtDyReachesLink: tapped });
              }
            }
            return { link: box(A), linkStyle: `${cs.display} min-h ${cs.minHeight} valign ${cs.verticalAlign}`, parent: `${parent.tagName.toLowerCase()} line-height ${pcs.lineHeight} font ${pcs.fontSize}`, lines: Array.from(a.getClientRects()).length, hits };
          });
          console.log(`[ML] ${width} ${path} link ${i}: ${JSON.stringify(m)}`);
        }
        if (!n) console.log(`[ML] ${width} ${path}: no support link`);
      }
      expect(true).toBe(true);
      await page.screenshot({ path: `qa/.shots/mail-link-${width}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}
