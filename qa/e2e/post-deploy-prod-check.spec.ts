/* POST-DEPLOY PRODUCTION CHECK (owner: "repeat the tests on prod after a release"). READ-ONLY, SIGNED OUT, NO PAID CALLS. About 10 minutes.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=https://liquidity-hq.com -f allow_production=true -f project=desktop -f spec=qa/e2e/post-deploy-prod-check.spec.ts
 * Every page gets the paid-AI fence (any request to a paid route is aborted and recorded, and the cell fails if one was attempted); signed out, GlobalMacroContext and DryPowder do not call anyway.
 *   P1  landing '/' renders: the hero heading, the LIVE READ panel and its ENTRY / STOP / TARGET headers visible and inside the viewport at 390 and 1280
 *   P2  /news > Calendar: the table has event rows, six columns wide (four under 480), Impact values High / Medium / "-" only. If there are no rows it fails as DATA STATE (the econ snapshot was not refreshed), not as a layout verdict
 *   P3  /dashboard and /arena at 390 in en and ru: the document is no wider than the viewport (the ru Setup-card overflow of the 2026-11-17 candidate); a contributor list is printed on failure
 *   P4  /changelog shows the release entry (v2026.11.17)
 *   P5  /research, /funding, /correlation: no skeleton or "Loading" text left after 25 s (not stuck)
 * Each cell prints [PROD] lines so the run log is the evidence. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';
import { overflowAttribution } from './_overflow';
import { settleForShot } from './_settle';

async function fresh(browser: import('@playwright/test').Browser, width: number, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, lang);
  const page = await ctx.newPage(); await installPaidAiFence(page); return { ctx, page };
}

test.describe('post-deploy production check (signed out, read-only)', () => {
  test.describe.configure({ timeout: 180_000, retries: 1 });
  /* a sleeping service (free-plan staging, or a cold start) can take 40+ s to answer the first request (dry run 44016939776: P1 timed out at 45 s, then passed in 6 s): wake it before any cell measures */
  test.beforeAll(async ({ request }) => { for (let a = 0; a < 3; a++) { const ok = await request.get('/api/version', { timeout: 90_000 }).then((r) => r.ok()).catch(() => false); if (ok) return; } });

  for (const width of [390, 1280]) test(`P1 landing renders at ${width}`, async ({ browser }) => {
    const { ctx, page } = await fresh(browser, width);
    try {
      await gotoGuarded(page, '/', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(3_000); await settleForShot(page, `prod-landing-${width}`);
      const m = await page.evaluate(() => { const vw = window.innerWidth; const heads = ['ENTRY', 'STOP', 'TARGET'].map((w) => { const h = Array.from(document.querySelectorAll('*')).find((k) => k.children.length === 0 && (k.textContent || '').trim().toUpperCase() === w); if (!h) return `${w}:missing`; const r = h.getBoundingClientRect(); return `${w}:${r.width > 0 && r.right <= vw + 1 ? 'visible' : 'CUT@' + Math.round(r.right)}`; }); return { vw, docW: document.documentElement.scrollWidth, heads, h1: (document.querySelector('.lp-hero-h1')?.textContent || '').trim().slice(0, 60) }; });
      console.log(`[PROD] P1 ${width}: docW=${m.docW}/${m.vw} headers=${JSON.stringify(m.heads)} h1="${m.h1}"`);
      expect(m.h1.length, 'no hero heading').toBeGreaterThan(5); expect(m.docW, 'landing scrolls sideways').toBeLessThanOrEqual(m.vw); expect(m.heads.filter((h) => !h.endsWith(':visible')), 'a LIVE READ column header is missing or cut').toEqual([]);
      assertNoUnstubbedPaidAi(page, `P1 ${width}`);
    } finally { await ctx.close(); }
  });

  for (const width of [390, 1280]) test(`P2 /news Calendar table at ${width}`, async ({ browser }) => {
    const { ctx, page } = await fresh(browser, width);
    try {
      await gotoGuarded(page, '/news'); const tab = page.locator('.ntab-btn').filter({ hasText: /^\s*(calendar|events)\s*$/i }).first(); await tab.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(2_500);
      for (let a = 0; a < 4; a++) { await tab.click({ timeout: 30_000 }); if (await page.locator('.ntab-btn.on').filter({ hasText: /^\s*(calendar|events)\s*$/i }).count()) break; await page.waitForTimeout(1_500); }
      const has = await page.locator('.ne-row').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
      if (!has) throw new Error('DATA STATE, not a layout verdict: the Calendar tab has no event rows (the econ snapshot on this environment was not refreshed)');
      const m = await page.evaluate(() => { const all = Array.from(document.querySelectorAll('.ne-row')) as HTMLElement[]; const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && getComputedStyle(e).display !== 'none'; const cols = (el: HTMLElement) => getComputedStyle(el).gridTemplateColumns.split(' ').length; const hdr = all[0]; const hdrWord = (hdr.querySelector('.ne-imp')?.textContent || '').trim();
        return { n: all.length, cols: cols(hdr), mismatch: all.filter((r) => cols(r) !== cols(hdr)).length, impacts: Array.from(new Set(all.flatMap((r) => Array.from(r.querySelectorAll('.ne-imp'))).filter(vis).map((e) => (e.textContent || '').trim()).filter((v) => v !== hdrWord))), docW: document.documentElement.scrollWidth, vw: window.innerWidth }; });
      console.log(`[PROD] P2 ${width}: rows=${m.n} cols=${m.cols} mismatch=${m.mismatch} impacts=${JSON.stringify(m.impacts)} docW=${m.docW}/${m.vw}`);
      expect(m.mismatch).toBe(0); expect(m.docW).toBeLessThanOrEqual(m.vw); expect(m.cols).toBe(width < 480 ? 4 : 6); for (const v of m.impacts) expect(['High', 'Medium', '-']).toContain(v);
      if (width >= 480) expect(m.impacts.length, 'no Impact value on a 6-column table').toBeGreaterThan(0);
      assertNoUnstubbedPaidAi(page, `P2 ${width}`);
    } finally { await ctx.close(); }
  });

  for (const lang of ['en', 'ru']) for (const path of ['/dashboard', '/arena']) test(`P3 ${path} at 390 in ${lang}: no sideways scroll`, async ({ browser }) => {
    const { ctx, page } = await fresh(browser, 390, lang);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(6_000);
      let htmlLang = await page.evaluate(() => document.documentElement.lang); for (let t = 0; t < 2 && !htmlLang.toLowerCase().startsWith(lang); t++) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5_000); htmlLang = await page.evaluate(() => document.documentElement.lang); }
      if (!htmlLang.toLowerCase().startsWith(lang)) { console.log(`[PROD] P3 ${path} ${lang}: language did not apply (html lang="${htmlLang}"): NOT MEASURED`); test.skip(true, 'language did not apply'); return; }
      await settleForShot(page, `prod-${path}-${lang}`);
      const m = await page.evaluate(`(${overflowAttribution.toString()})()`) as { docW: number; winW: number; contributors: string[] };
      console.log(`[PROD] P3 ${path} ${lang}: docW=${m.docW}/${m.winW} contributors=${JSON.stringify(m.contributors)}`);
      expect(m.docW, `${path} in ${lang} scrolls sideways: ${m.contributors.slice(0, 3).join(' | ')}`).toBeLessThanOrEqual(m.winW);
      assertNoUnstubbedPaidAi(page, `P3 ${path} ${lang}`);
    } finally { await ctx.close(); }
  });

  test('P4 /changelog shows the release entry', async ({ browser }) => {
    /* The page never renders the tag (it is only the React key): it renders <time datetime="YYYY-MM-DD"> and the entry's lines. So: an entry dated 2026-11-17 whose list holds a line that is unique to THIS release. */
    const { ctx, page } = await fresh(browser, 1280);
    try {
      await gotoGuarded(page, '/changelog', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.locator('time').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(2_000);
      const m = await page.evaluate((line) => { const times = Array.from(document.querySelectorAll('time[datetime="2026-11-17"]')); const hit = times.some((t) => { let p: HTMLElement | null = t as HTMLElement; for (let k = 0; k < 5 && p; k++, p = p.parentElement) if ((p.innerText || '').includes(line)) return true; return false; }); return { dated: times.length, hit, text: document.body.innerText }; }, 'full advertised daily AI allowance');
      console.log(`[PROD] P4: entries dated 2026-11-17=${m.dated} uniqueLineInThatEntry=${m.hit}`);
      expect(m.dated, '/changelog has no entry dated 2026-11-17').toBeGreaterThan(0); expect(m.hit, 'no 2026-11-17 entry holds the line unique to this release (the AI allowance line)').toBe(true);
      expect(m.text, 'a raw internal token on the changelog').not.toMatch(/(TRENDING_SHORT|BOS_CONFIRMED)/); assertNoUnstubbedPaidAi(page, 'P4');
    } finally { await ctx.close(); }
  });

  for (const path of ['/research', '/funding', '/correlation']) test(`P5 ${path} is not stuck loading`, async ({ browser }) => {
    const { ctx, page } = await fresh(browser, 390);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(25_000);
      const m = await page.evaluate(() => ({ skeletons: Array.from(document.querySelectorAll('.skel-bar')).filter((e) => (e as HTMLElement).offsetParent !== null).length, loadingText: Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && /^(loading|preparing)\b/i.test((e.textContent || '').trim())).map((e) => (e.textContent || '').trim().slice(0, 40)).slice(0, 4) }));
      console.log(`[PROD] P5 ${path}: skeletons=${m.skeletons} loadingText=${JSON.stringify(m.loadingText)}`);
      expect(m.skeletons, `${path}: a skeleton is still showing after 25 s`).toBe(0); expect(m.loadingText, `${path}: loading text after 25 s`).toEqual([]);
      assertNoUnstubbedPaidAi(page, `P5 ${path}`);
    } finally { await ctx.close(); }
  });
});
