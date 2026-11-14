/* Where the first-visit sound question sits after #2351 (it moved from above the chart to under the Strategy card). Shots from a CI build of the branch, signed in as fixture A with the settings read stubbed to "no answer yet" and the write stubbed, so nothing reaches the dev row.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/sound-prompt-placement.spec.ts -f screenshots=true -f project=desktop
 * Files in qa/.shots: sound-placement-<width>-<theme>.png (the viewport), sound-placement-element-<width>-<theme>.png (the prompt alone), sound-placement-context-<width>-<theme>.png (strategy card + prompt + what is next to them).
 * It also PRINTS the geometry (prompt vs Strategy card vs chart: top/bottom/left, and whether the prompt comes after the chart in the DOM) so the placement is a measurement, not only a picture. */
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots'; mkdirSync(DIR, { recursive: true });
const mask = (p: import('@playwright/test').Page) => [p.locator('.tnav-drop-email'), p.locator('text=/@/')];

async function open(browser: Browser, width: number, theme: string) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async route => {
    const req = route.request(); if (req.method() === 'GET') return route.fallback();
    const sent = Object.keys((req.postDataJSON() ?? {}) as Record<string, unknown>).filter(k => k !== 'knownAsOf');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: sent, rejected: [], settings: null }) });
  });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, arena_sound: null, language: 'en' });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  return { ctx, page };
}

test.describe('sound prompt placement (#2351)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });
  for (const theme of ['dark', 'light'] as const) for (const width of [390, 1280] as const) {
    test(`the sound prompt sits under the Strategy card, after the chart: ${width} ${theme}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, width, theme);
      try {
        await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(14_000);
        const prompt = page.getByTestId('arena-sound-prompt'); await expect(prompt, 'the first-visit prompt is not shown').toBeVisible({ timeout: 30_000 });
        const g = await page.evaluate(() => {
          const r = (el: Element | null) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
          const p = document.querySelector('[data-testid="arena-sound-prompt"]'); const c = document.querySelector('[data-testid="arena-strategy-card"]'); const k = document.querySelector('.klc-wrap');
          const after = (a: Element | null, b: Element | null) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING));
          return { prompt: r(p), card: r(c), chart: r(k), promptAfterChartInDom: after(p, k), promptAfterCardInDom: after(p, c), vw: innerWidth, docSw: document.documentElement.scrollWidth };
        });
        console.log(`[PLACEMENT] ${width} ${theme} ${JSON.stringify(g)}`);
        await prompt.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
        await page.screenshot({ path: `${DIR}/sound-placement-${width}-${theme}.png`, mask: mask(page), maskColor: '#000000' });
        await prompt.screenshot({ path: `${DIR}/sound-placement-element-${width}-${theme}.png` });
        /* context: the Strategy card and the prompt together, with what sits around them (the column that holds the prompt) */
        const col = prompt.locator('xpath=ancestor::*[contains(@class,"arena") or self::aside or self::section][1]');
        await ((await col.count()) ? col.first() : prompt).screenshot({ path: `${DIR}/sound-placement-context-${width}-${theme}.png`, mask: mask(page), maskColor: '#000000' }).catch((e) => console.log(`[PLACEMENT] context shot skipped: ${String(e).slice(0, 80)}`));
        expect(g.promptAfterChartInDom, 'the prompt is still before the chart in the page: it can push the chart down again').toBe(true);
        expect(g.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(g.vw);
        if (g.card && g.prompt && width >= 1000) expect(g.prompt.top, 'the prompt is not under the Strategy card').toBeGreaterThanOrEqual(g.card.bottom - 2);
      } finally { await ctx.close(); }
    });
  }
});
