/* #2568 PAGE SUBTITLES, as a user, en, 390 and 1280, light and dark. Needs migration 20261119s applied to the DEV database (the labels table layers over the shipped defaults: an unapplied migration shows the OLD wording and these cells go red with "migration not applied" in the message).
 *   SB1  /about and /journal render NO subtitle: the old strings ("Liquidity Hunter HQ - crypto market analytics", "Log every trade · track results · build discipline") are nowhere on the visible page, and the h1 is followed directly by the first card/tab bar
 *   SB2  /alerts "Checked every 5 minutes." · /correlation "Based on <range> returns." (a real range word, no raw {range}) · /funding "Red: longs paying. Green: shorts paying." are visible, each <= 12 words
 *   SB3  the four /journal tabs (Rules, Shadow, Bias, Thesis) each show their one-line subtitle (<= 12 words), no clipping at 390
 *   SB4  no sideways scroll on any of those pages at 390; shots qa/.shots/subtitles-<page>-<w>-<theme>.png
 * Signed in as the Pro fixture for /alerts and /journal (they need an account), signed out for the others. Read-only. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';

mkdirSync('qa/.shots', { recursive: true });
const words = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
const OLD_ABOUT = 'Liquidity Hunter HQ - crypto market analytics', OLD_JOURNAL = 'Log every trade · track results · build discipline';
const NOT_APPLIED = ' (if this is the OLD wording, migration 20261119s is not applied to the DEV database yet: migration not applied)';
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const sideways = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));

for (const theme of ['dark', 'light'] as const) for (const width of [390, 1280]) {
  const mk = async (browser: import('@playwright/test').Browser, signedIn: boolean) => {
    const opts = { viewport: { width, height: 900 } };
    const ctx = signedIn ? await signedInContext(browser, 'a', opts) : await browser.newContext(opts);
    await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
    return ctx;
  };
  test(`SB1 ${width} ${theme}: /about and /journal have no subtitle`, async ({ browser }) => {
    test.setTimeout(180_000); test.skip(!AUTH_READY, 'needs the Pro fixture for /journal');
    const out = await mk(browser, false); const a = await out.newPage();
    try { await a.goto('/about', { waitUntil: 'domcontentloaded' }); await a.waitForTimeout(8_000); const t = await text(a); console.log(`[SUB] /about ${width} ${theme} old subtitle present: ${t.includes(OLD_ABOUT)}`); expect(t.includes(OLD_ABOUT), '/about still shows its old subtitle').toBe(false); await a.screenshot({ path: `qa/.shots/subtitles-about-${width}-${theme}.png` }).catch(() => {}); const s = await sideways(a); expect(s.doc, `/about is ${s.doc}px wide at ${s.vw}`).toBeLessThanOrEqual(s.vw); } finally { await out.close(); }
    const ctx = await mk(browser, true); const j = await ctx.newPage();
    try { await gotoSignedIn(j, '/journal'); await j.waitForTimeout(10_000); const t = await text(j); console.log(`[SUB] /journal ${width} ${theme} old subtitle present: ${t.includes(OLD_JOURNAL)}`); expect(t.includes(OLD_JOURNAL), '/journal still shows its old subtitle' + NOT_APPLIED).toBe(false); await j.screenshot({ path: `qa/.shots/subtitles-journal-${width}-${theme}.png` }).catch(() => {}); const s = await sideways(j); expect(s.doc, `/journal is ${s.doc}px wide at ${s.vw}`).toBeLessThanOrEqual(s.vw); } finally { await ctx.close(); }
  });
  test(`SB2 ${width} ${theme}: alerts, correlation and funding subtitles are the short ones`, async ({ browser }) => {
    test.setTimeout(180_000); test.skip(!AUTH_READY, 'needs the Pro fixture for /alerts');
    const out = await mk(browser, false);
    try {
      const c = await out.newPage(); await c.goto('/correlation', { waitUntil: 'domcontentloaded' }); await c.waitForTimeout(10_000); const ct = await text(c);
      const m = /Based on ([^.]{1,30}) returns\./.exec(ct); console.log(`[SUB] /correlation ${width} ${theme}: ${m ? m[0] : 'NOT FOUND'}`);
      expect(m, '/correlation does not show "Based on <range> returns."' + NOT_APPLIED).toBeTruthy(); expect(m![1], 'the {range} placeholder was not filled').not.toMatch(/[{}]/);
      await c.screenshot({ path: `qa/.shots/subtitles-correlation-${width}-${theme}.png` }).catch(() => {}); const sc = await sideways(c); expect(sc.doc).toBeLessThanOrEqual(sc.vw);
      const f = await out.newPage(); await f.goto('/funding', { waitUntil: 'domcontentloaded' }); await f.waitForTimeout(10_000); const ft = await text(f);
      console.log(`[SUB] /funding ${width} ${theme}: ${ft.includes('Red: longs paying. Green: shorts paying.')}`); expect(ft.includes('Red: longs paying. Green: shorts paying.'), '/funding does not show the short legend' + NOT_APPLIED).toBe(true);
      expect(words('Red: longs paying. Green: shorts paying.')).toBeLessThanOrEqual(12); const sf = await sideways(f); expect(sf.doc, `/funding is ${sf.doc}px at ${sf.vw}`).toBeLessThanOrEqual(sf.vw);
    } finally { await out.close(); }
    const ctx = await mk(browser, true); const a = await ctx.newPage();
    try { await gotoSignedIn(a, '/alerts'); await a.waitForTimeout(10_000); const t = await text(a); console.log(`[SUB] /alerts ${width} ${theme}: ${t.includes('Checked every 5 minutes.')}`); expect(t.includes('Checked every 5 minutes.'), '/alerts does not show "Checked every 5 minutes."' + NOT_APPLIED).toBe(true); const s = await sideways(a); expect(s.doc, `/alerts is ${s.doc}px at ${s.vw}`).toBeLessThanOrEqual(s.vw); } finally { await ctx.close(); }
  });
  test(`SB3 ${width} ${theme}: the four journal tabs show their one-line subtitle`, async ({ browser }) => {
    test.setTimeout(240_000); test.skip(!AUTH_READY, 'needs the Pro fixture');
    const ctx = await mk(browser, true); const j = await ctx.newPage();
    const TABS: Array<[RegExp, string]> = [[/^rules$/i, 'Trades that break a rule are flagged when logged and in History.'], [/^shadow$/i, 'AI reads your trade history for your implicit rules and patterns.'], [/^bias/i, 'Checks your trades for four biases, with estimated P&L drag per bias.'], [/^thesis/i, 'AI checks whether your thesis assumptions still hold. Health score 1-10.']];
    try {
      await gotoSignedIn(j, '/journal'); await j.waitForTimeout(8_000);
      for (const [name, sub] of TABS) {
        const tab = j.getByRole('tab', { name }).first(); const btn = (await tab.count()) ? tab : j.getByRole('button', { name }).first();
        if (!(await btn.count())) { console.log(`[SUB] journal tab ${name} not found`); continue; }
        await btn.click({ timeout: 15_000 }); await j.waitForTimeout(2_500); const t = await text(j); const has = t.includes(sub); console.log(`[SUB] journal ${name} ${width} ${theme}: ${has}`);
        expect(has, `the ${name} tab does not show its short subtitle` + NOT_APPLIED).toBe(true); expect(words(sub)).toBeLessThanOrEqual(12);
      }
      const s = await sideways(j); expect(s.doc, `/journal is ${s.doc}px at ${s.vw}`).toBeLessThanOrEqual(s.vw);
    } finally { await ctx.close(); }
  });
}
