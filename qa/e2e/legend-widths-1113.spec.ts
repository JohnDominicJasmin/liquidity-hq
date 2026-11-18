/* THE ARENA CHART LEGEND (#2587, tracker #1113), as a user, signed out, read-only, a deployed site, light and dark.
 *   LG1  at 360 / 390 / 430 / 768 / 1024 / 1280: the "?" button is on the chart toolbar, a real button, at least 24 x 22 px; a tap opens a region named "Chart labels" that lists the eight lines
 *        (R / S, MAX PAIN, GAMMA FLIP, REALIZED, T . E . S, up n, down n, A-F); the panel lies INSIDE the viewport (left >= 0, right <= viewport width), the page does not scroll sideways, and the panel
 *        does not cover the toolbar's own buttons (the panel's box and the "?" button's row may touch, but no OTHER toolbar button is under the panel's centre line).
 *   LG2  keyboard: Tab to the "?" then Enter opens; Escape closes AND focus returns to the "?"; opening again then a click on the chart canvas closes it. aria-expanded follows.
 * Shots: qa/.shots/legend-<width>-<theme>.png. Needs the migration 20261119z4 only for non-English copy; English works from the shipped defaults. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });
const WIDTHS = [360, 390, 430, 768, 1024, 1280];

async function openArena(page: Page) {
  await page.goto('/arena?coin=btc', { waitUntil: 'domcontentloaded' });
  const btn = page.getByRole('button', { name: /what the chart labels mean|chart labels|chart key/i }).first();
  await expect(btn, 'CONTROL: the legend "?" button is not on /arena').toBeVisible({ timeout: 60_000 });
  return btn;
}

for (const theme of ['dark', 'light'] as const) for (const width of WIDTHS) {
  test(`LG1 ${width} ${theme}: the legend panel opens inside the viewport and covers nothing it should not`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
    const page = await ctx.newPage();
    try {
      const btn = await openArena(page);
      await page.waitForTimeout(4_000);
      const bb = (await btn.boundingBox())!;
      console.log(`[LG] ${width} ${theme} button ${Math.round(bb.width)}x${Math.round(bb.height)} at x=${Math.round(bb.x)}`);
      expect(bb.width, '? button width').toBeGreaterThanOrEqual(24);
      expect(bb.height, '? button height').toBeGreaterThanOrEqual(22);
      await btn.click();
      const panel = page.getByRole('region', { name: /chart labels/i }).first();
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      const pb = (await panel.boundingBox())!;
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      const text = (await panel.innerText()).replace(/\s+/g, ' ');
      console.log(`[LG] ${width} ${theme} panel left ${Math.round(pb.x)} right ${Math.round(pb.x + pb.width)} (viewport ${vw}) lines: ${text.slice(0, 160)}`);
      expect(pb.x, `panel left edge at ${width}`).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width, `panel right edge at ${width}`).toBeLessThanOrEqual(vw + 0.5);
      for (const needle of [/R\s*\/\s*S/i, /max pain/i, /flip/i, /realized/i, /T\s*[·.]\s*E\s*[·.]\s*S/i, /A\s*[–-]\s*F/i]) expect(text, `legend text lacks ${needle}`).toMatch(needle);
      const sw = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      expect(sw.doc, `/arena scrolls sideways at ${width}`).toBeLessThanOrEqual(sw.vw);
      /* no other toolbar button under the panel's vertical centre */
      const covered = await page.evaluate(([x0, x1, y]) => {
        const hit: string[] = [];
        for (let x = Math.ceil(x0) + 2; x < x1 - 2; x += 8) { const el = document.elementFromPoint(x, y); const b = el && el.closest('button'); if (b && !b.closest('[role="region"]') && !/chart labels/i.test(b.getAttribute('aria-label') || '')) hit.push((b.textContent || '').trim().slice(0, 12)); }
        return hit;
      }, [pb.x, pb.x + pb.width, pb.y + pb.height / 2] as [number, number, number]);
      expect(covered, 'toolbar buttons seen through the panel centre').toEqual([]);
      await page.screenshot({ path: `qa/.shots/legend-${width}-${theme}.png` }).catch(() => {});
    } finally { await ctx.close(); }
  });
}

test('LG2 keyboard: Enter opens, Escape closes and returns focus to the ?, a click outside closes', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    const btn = await openArena(page);
    await page.waitForTimeout(3_000);
    await btn.focus();
    const before = await btn.evaluate((el) => ({ active: document.activeElement === el, expanded: el.getAttribute('aria-expanded'), tag: document.activeElement?.tagName, label: (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') }));
    await btn.press('Enter');
    const after = await btn.evaluate((el) => ({ active: document.activeElement === el, expanded: el.getAttribute('aria-expanded') }));
    console.log(`[LG2] before ${JSON.stringify(before)} after Enter ${JSON.stringify(after)}`);
    const panel = page.getByRole('region', { name: /chart labels/i }).first();
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden({ timeout: 5_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    const focusedIsBtn = await btn.evaluate((el) => document.activeElement === el);
    expect(focusedIsBtn, 'focus did not return to the ? after Escape').toBe(true);
    await btn.click(); await expect(panel).toBeVisible();
    await page.mouse.click(40, 600);
    await expect(panel).toBeHidden({ timeout: 5_000 });
  } finally { await ctx.close(); }
});
