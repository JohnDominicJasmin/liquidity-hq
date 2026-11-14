/* #2299 (owner option A on #1651): the plain line under the /alerts subtitle, "Signals, not predictions. ...".
 *   A1  en at 1280 and 390, dark and light: the line shows, is the label's sentence, sits under the subtitle, stays inside the viewport, the page does not scroll sideways; shot at 390 and 1280
 *   A2  ko, zh and ru at 1280 and 390: the line shows in that language (script check) and keeps the figure "24"; needs the dev project's labels applied (migration 20261114b), so these run only
 *       against a deployed build (E2E_BASE_URL); on a local build they skip with the reason, they do not pass
 * Signed out, reads only. A cell that finds no line fails. */
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
const EN = "Signals, not predictions. Past alerts moved the alert's way about half the time at 24 hours.";
async function open(browser: Browser, width: number, loc: string, theme: 'dark' | 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [loc, theme]);
  await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
  const page = await ctx.newPage(); await gotoGuarded(page, '/alerts'); await page.waitForTimeout(12_000);
  return { ctx, page };
}
const read = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const n = document.querySelector('[data-testid="alerts-signals-note"]') as HTMLElement | null;
  if (!n) return { found: false as const, url: location.pathname, body: document.body.innerText.slice(0, 120) };
  const r = n.getBoundingClientRect(); const prev = n.previousElementSibling as HTMLElement | null; const pr = prev ? prev.getBoundingClientRect() : null;
  return { found: true as const, text: (n.textContent || '').trim(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), h: Math.round(r.height), prevBottom: pr ? Math.round(pr.bottom) : null, prevText: prev ? (prev.textContent || '').trim().slice(0, 40) : null, docSw: document.documentElement.scrollWidth, vw: window.innerWidth };
});

for (const width of [1280, 390]) for (const th of ['dark', 'light'] as const) {
  test(`A1. /alerts en ${width} ${th}: the line shows under the subtitle, inside the viewport`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await open(browser, width, 'en', th);
    try {
      const m = await read(page); console.log(`[A1] ${width} ${th} ${JSON.stringify(m)}`);
      await page.screenshot({ path: `qa/.shots/alerts-note-${width}-${th}.png` });
      expect(m.found, `the line is not on /alerts (${m.found ? '' : JSON.stringify(m)})`).toBe(true);
      if (!m.found) return;
      expect(m.text).toBe(EN);
      expect(m.top, 'the line is not below the subtitle above it').toBeGreaterThanOrEqual((m.prevBottom ?? 0) - 1);
      expect(m.left).toBeGreaterThanOrEqual(0); expect(m.right, 'the line runs past the viewport').toBeLessThanOrEqual(m.vw);
      expect(m.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(m.vw);
      if (width === 390) expect(m.h, 'at 390 the sentence wraps onto more than one line').toBeGreaterThan(20);
    } finally { await ctx.close(); }
  });
}

const SCRIPT: Record<string, RegExp> = { ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/ };
for (const loc of ['ko', 'zh', 'ru']) for (const width of [1280, 390]) {
  test(`A2. /alerts ${loc} ${width}: the line is in that language and keeps the 24-hour figure`, async ({ browser }) => {
    test.skip(!process.env.E2E_BASE_URL, 'needs the dev project labels (20261114b) on a deployed build: skipped on a local build, not passed');
    test.setTimeout(120_000);
    const { ctx, page } = await open(browser, width, loc, 'dark');
    try {
      const m = await read(page); console.log(`[A2] ${loc} ${width} ${JSON.stringify(m)}`);
      if (width === 390) await page.screenshot({ path: `qa/.shots/alerts-note-${loc}-390.png` });
      expect(m.found, `the line is not on /alerts in ${loc}`).toBe(true);
      if (!m.found) return;
      expect(m.text, `the ${loc} line is still the English default`).not.toBe(EN);
      expect(m.text).toMatch(SCRIPT[loc]); expect(m.text).toMatch(/24/);
      expect(m.right).toBeLessThanOrEqual(m.vw); expect(m.docSw).toBeLessThanOrEqual(m.vw);
    } finally { await ctx.close(); }
  });
}
