/* #2510 UI BATCH CELLS (PM audit 2026-11-17), signed out, read only, light + dark at 390 / 768 / 1280. Screenshots to qa/.shots/ui2510-<cell>-<theme>-<width>.png for the visual sign-off.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f screenshots=true -f "spec=qa/e2e/ui-batch-2510.spec.ts"
 *   U1  landing "/": the live-read card says NO SETUP YET, and there is no Entry / Stop / Target label row anywhere in it
 *   U2  /arena: the floating Ask AI button is HIDDEN at 390 and 768 and still shown at 1280; on /dashboard at 390 it is still shown (the rule is the Arena's only)
 *   U3  /markets at 390 and 480: the Signal text cells do not overflow their cell and the page has no sideways scroll; the short form is what shows (the full form is display:none)
 *   U4  /liq: the window stat reads "N of 17 zones", never "N/17"
 *   U5  the terminal nav says Funding and Journal, never Flow or Book
 *   U6  /funding: one vocabulary: none of Contrarian Short/Long, Longs Heavy, Longs Dominant, Shorts Crowded, Shorts Dominant, Slight Long Bias as a LABEL (Long-heavy / Short-heavy belong to other keys and are not checked); the states read Longs paying / Shorts paying / Balanced
 * A cell that fails ONLY because the page still shows an old STORED label means migration 20261118i / 20261118j is not applied to the database this build reads (stored rows win over defaults): it is reported as that, not as a code defect. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { settleForShot } from './_settle';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';

mkdirSync('qa/.shots', { recursive: true });
const THEMES = ['light', 'dark'] as const, WIDTHS = [390, 768, 1280] as const;
const open = async (page: Page, path: string, theme: string, width: number) => {
  await page.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  await page.setViewportSize({ width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 });
  await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(9_000);
};
const shot = async (page: Page, name: string, theme: string, width: number) => { await settleForShot(page, name).catch(() => {}); await page.screenshot({ path: `qa/.shots/ui2510-${name}-${theme}-${width}.png`, fullPage: false, timeout: 20_000 }).catch(() => {}); };
const body = async (page: Page) => ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');

for (const theme of THEMES) for (const width of WIDTHS) {
  test(`U1:${theme}:${width}: landing live-read card says NO SETUP YET and has no Entry/Stop/Target row`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, '/', theme, width);
    const t = await body(page); const i = t.search(/live read/i); const card = i < 0 ? t.slice(0, 1500) : t.slice(i, i + 900);
    console.log(`[UI2510] U1 ${theme} ${width}: ${card.slice(0, 220)}`);
    await shot(page, 'landing', theme, width);
    expect(/NO SETUP YET/i.test(card), 'the live-read card does not say NO SETUP YET').toBe(true);
    expect(/\bNO READ\b/i.test(card), 'the old NO READ headline is still shown').toBe(false);
    expect(/\bentry\b[\s\S]{0,40}\bstop\b[\s\S]{0,40}\btarget\b/i.test(card), 'an Entry / Stop / Target row is still in the live-read card').toBe(false);
  });

  test(`U2:${theme}:${width}: floating Ask AI is hidden on /arena at phone widths, shown at 1280, and still shown elsewhere`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, '/arena', theme, width);
    const fab = page.locator('.gchat-fab').first(); const shown = await fab.isVisible().catch(() => false);
    console.log(`[UI2510] U2 ${theme} ${width}: /arena Ask AI visible=${shown}`);
    await shot(page, 'arena', theme, width);
    if (width <= 768) expect(shown, `the floating Ask AI is visible on /arena at ${width}`).toBe(false); else expect(shown, 'the floating Ask AI is gone on /arena at 1280 (the rule is phone-only)').toBe(true);
    if (width === 390) { await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(9_000); const other = await page.locator('.gchat-fab').first().isVisible().catch(() => false); console.log(`[UI2510] U2 ${theme} 390: /dashboard Ask AI visible=${other}`); expect(other, 'the Ask AI button disappeared on a page other than the Arena').toBe(true); }
  });

  test(`U3:${theme}:${width}: /markets signal text fits (390 and 480 use the short form)`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, '/markets', theme, width);
    const m = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.mkt-sig-short, .mkt-sig-full')) as HTMLElement[]; const vis = cells.filter((c) => c.offsetParent !== null || getComputedStyle(c).display !== 'none');
      const over = vis.filter((c) => { const p = c.parentElement as HTMLElement; return p && p.scrollWidth > p.clientWidth + 1; }).length;
      return { cells: cells.length, shortShown: cells.filter((c) => c.classList.contains('mkt-sig-short') && getComputedStyle(c).display !== 'none').length, fullShown: cells.filter((c) => c.classList.contains('mkt-sig-full') && getComputedStyle(c).display !== 'none').length, over, docW: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    console.log(`[UI2510] U3 ${theme} ${width}: ${JSON.stringify(m)}`);
    await shot(page, 'markets', theme, width);
    expect(m.docW, `/markets scrolls sideways at ${width} (${m.docW} > ${m.vw})`).toBeLessThanOrEqual(m.vw);
    expect(m.over, 'a signal cell overflows its parent').toBe(0);
    if (m.cells > 0 && width <= 480) { expect(m.fullShown, 'the FULL signal text still shows on a phone').toBe(0); }
  });

  test(`U4/U5:${theme}:${width}: /liq says "N of 17 zones"; the nav says Funding and Journal`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, '/liq', theme, width);
    const t = await body(page); console.log(`[UI2510] U4 ${theme} ${width}: ${(t.match(/\d+\s*(?:of|\/)\s*17 zones[^.]{0,30}/i) ?? ['(none)'])[0]}`);
    await shot(page, 'liq', theme, width);
    expect(/\b\d+\/17 zones/i.test(t), 'the old "N/17 zones" form is still shown').toBe(false);
    expect(/\b\d+ of 17 zones/i.test(t), 'the stat does not read "N of 17 zones"').toBe(true);
  });

  test(`U6:${theme}:${width}: /funding uses one vocabulary`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, '/funding', theme, width);
    const t = await body(page); const bad = (t.match(/Contrarian (?:Short|Long)|Longs? Heavy|Longs? Dominant|Shorts? Crowded|Shorts? Dominant|Slight Long Bias/gi) ?? []);
    console.log(`[UI2510] U6 ${theme} ${width}: old words ${JSON.stringify([...new Set(bad)])}; new words present: ${/Longs paying|Shorts paying|Balanced/.test(t)}`);
    await shot(page, 'funding', theme, width);
    expect(bad, 'old funding vocabulary is still shown (a stored label row not yet replaced by 20261118j?)').toEqual([]);
  });
}

/* U5: the terminal tab bar is the SIGNED-IN navigation (TerminalNav .tnav-tab-label): the labels read Funding and Journal, never Flow or Book. Pro fixture, light + dark at 390 / 768 / 1280. */
for (const theme of THEMES) for (const width of WIDTHS) test(`U5:${theme}:${width}: the terminal tabs say Funding and Journal`, async ({ browser }) => {
  test.setTimeout(120_000); test.skip(!AUTH_READY, 'the signed-in fixtures are not configured on this run');
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage();
  try {
    await gotoSignedIn(page, '/dashboard'); await page.waitForTimeout(8_000);
    const labels = await page.locator('.tnav-tab-label').allInnerTexts(); console.log(`[UI2510] U5 ${theme} ${width}: tab labels ${JSON.stringify(labels)}`);
    await shot(page, 'nav', theme, width);
    expect(labels.length, 'no terminal tab labels found on /dashboard: the cell cannot judge the nav').toBeGreaterThan(0);
    expect(labels.some((l) => /^funding$/i.test(l.trim())) && labels.some((l) => /^journal$/i.test(l.trim())), `the tabs do not read Funding and Journal: ${JSON.stringify(labels)}`).toBe(true);
    expect(labels.some((l) => /^(flow|book)$/i.test(l.trim())), 'a tab still reads Flow or Book').toBe(false);
  } finally { await ctx.close(); }
});
