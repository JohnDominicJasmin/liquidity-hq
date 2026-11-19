/* #1651 L103 (PM, v2026.11.21 verification): /research as the Pro fixture, first visit WARM (the server already answered a request, the browser has no cache or storage), after #2628's precompute: the Stablecoin Dry Powder card shows its AI text (or its dated latest text) within 5 s of navigation start, never says "Preparing" for 15 s, and never says "unavailable". Read-only; the AI routes are fenced (dry-powder reads the stored row and is not in the fence list; macro-context and onchain ARE fenced, so those cards may show their own error state: this cell judges only the dry-powder card). Prints [DP] lines with the numbers. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const card = (page: Page) => page.evaluate(() => {
  /* the title sits inside a tooltip wrapper next to an info icon, so match the SMALLEST element whose text starts with the title (case-insensitive: the page uppercases it with CSS only) */
  const h = Array.from(document.querySelectorAll('*')).filter((e) => /^stablecoin dry powder/i.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40).sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
  if (!h) return { found: false, text: '' };
  /* climb to the card: the largest ancestor that still holds ONLY this card (stop before the text of any other section heading appears) */
  let el: HTMLElement | null = h as HTMLElement; while (el && el.parentElement && !/global macro context|volatility regime|btc crowding|cycle day/i.test(el.parentElement.innerText || '')) el = el.parentElement;
  return { found: true, text: ((el?.innerText || '') as string).replace(/\s+/g, ' ').trim() };
});
for (const round of ['warm-1', 'warm-2']) {
  test(`DP ${round}: /research Pro first visit: the dry-powder card has its text within 5 s, no "Preparing" for 15 s`, async ({ browser }) => {
    test.setTimeout(150_000);
    /* warm the server first with a throwaway request so the measured visit is not a cold wake */
    const warm = await browser.newContext(); await warm.request.get('/research').catch(() => {}); await warm.request.get('/api/version').catch(() => {}); await warm.close();
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      const t0 = Date.now(); await page.goto('/research', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      let tFound = -1, tText = -1, last = '', preparingAt = -1, lockedAt = -1, lockedUntil = -1; const trace: string[] = [];
      while (Date.now() - t0 < 20_000) {
        const s = await card(page).catch(() => ({ found: false, text: '' })); const t = Date.now() - t0; last = s.text;
        if (s.found && tFound < 0) tFound = t;
        const body = s.text.replace(/stablecoin dry powder/i, '');
        const preparing = /preparing|loading/i.test(s.text); if (preparing && preparingAt < 0) preparingAt = t;
        const locked = /with pro:|unlock|upgrade/i.test(s.text); if (locked && lockedAt < 0) lockedAt = t; if (locked) lockedUntil = t;
        if (s.found && !preparing && !locked && body.replace(/[^A-Za-z]/g, '').length > 120 && tText < 0) { tText = t; break; }
        if (trace.length < 12 && t % 1000 < 300) trace.push(`${t}ms: ${s.text.slice(0, 80)}`);
        await page.waitForTimeout(250);
      }
      console.log(`[DP] ${round}: card found at ${tFound} ms · text resolved at ${tText} ms · "Preparing/Loading" first seen at ${preparingAt} ms · locked/upgrade card seen from ${lockedAt} to ${lockedUntil} ms (a Pro account must not see one) · card text: ${last.slice(0, 260)}`); console.log(`[DP] ${round} trace: ${trace.join(' | ')}`);
      await page.screenshot({ path: `qa/.shots/dp-${round}.png` }).catch(() => {});
      expect(tFound, 'the Stablecoin Dry Powder card never rendered on /research').toBeGreaterThanOrEqual(0);
      expect(/unavailable/i.test(last), `the card says unavailable: ${last.slice(0, 160)}`).toBe(false);
      expect(tText, `the card never showed its text within 20 s (last: ${last.slice(0, 160)})`).toBeGreaterThanOrEqual(0);
      expect(tText, `the card text took ${tText} ms (target 5000)`).toBeLessThanOrEqual(5_000);
    } finally { await ctx.close().catch(() => {}); }
  });
}
