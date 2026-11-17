/* RELEASE CELLS 2026-11-17 (group run on qa): the measurable browser cells for #2405 and #2403. Signed out, nothing written, no paid calls.
 *   gh workflow run ci.yml --ref test/group-run-specs -f e2e=true -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop -f spec=qa/e2e/release-cells-2026-11-17.spec.ts
 *   T1  #2405: /arena chart toolbar at 1024 and 1280 in en, ru, ko, zh: from 1200 px the toolbar is ONE row (flex-wrap nowrap, height of a single control row) and the page has no sideways scroll; at 1024 it is allowed to wrap (we only require no sideways scroll)
 *   E1  #2403: /news Events at 390 / 768 / 1280: the table has no sideways scroll of the PAGE, every .ne-row has the same column count as the header, Previous and Impact are hidden under 480 and shown from 480, and the Impact cells read High / Medium / "-" only
 * Each cell prints its numbers ([CELL] lines) so the run log is the evidence. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { mkdirSync } from 'node:fs';
mkdirSync('qa/.shots', { recursive: true });

const LANGS = ['en', 'ru', 'ko', 'zh'] as const;
async function withLang(page: Page, lang: string) { await page.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private mode */ } }, lang); }

test.describe('#2405 chart toolbar stays one row from 1200 px', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const width of [1024, 1280]) for (const lang of LANGS) {
    test(`T1 /arena toolbar at ${width} in ${lang}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const page = await ctx.newPage(); await withLang(page, lang);
      try {
        await gotoGuarded(page, '/arena');
        const tb = page.locator('.klc-toolbar').first(); await tb.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(6_000);   // late chips and the plan badge arrive
        const m = await tb.evaluate((el) => {
          const kids = Array.from(el.children).filter((c) => (c as HTMLElement).offsetParent !== null) as HTMLElement[]; /* rows = bands of control CENTRES (controls of different heights have different tops even on one row) */
          const centres = kids.map((k) => { const r = k.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b); let bands = centres.length ? 1 : 0; for (let i = 1; i < centres.length; i++) if (centres[i] - centres[i - 1] > 14) bands++;
          return { wrap: getComputedStyle(el).flexWrap, h: Math.round(el.getBoundingClientRect().height), rows: bands, kids: kids.length, docW: document.documentElement.scrollWidth, winW: window.innerWidth };
        });
        console.log(`[CELL] T1 ${width} ${lang}: wrap=${m.wrap} height=${m.h} rows=${m.rows} children=${m.kids} docW=${m.docW}/${m.winW}`);
        expect(m.docW, `sideways scroll at ${width} in ${lang}`).toBeLessThanOrEqual(m.winW);
        if (width >= 1200) { expect(m.wrap, 'toolbar wraps on a wide screen').toBe('nowrap'); expect(m.rows, `toolbar is ${m.rows} rows at ${width} in ${lang}`).toBe(1); }
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2403 News > Events table', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const width of [390, 768, 1280]) {
    test(`E1 /news Events at ${width}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/news');
        await page.locator('.ntab-btn').filter({ hasText: /^\s*(calendar|events)\s*$/i }).first().click({ timeout: 60_000 });   // the tab is labelled "Calendar" (NEWS_TAB_EVENTS)
        const rows = page.locator('.ne-row'); await rows.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(async (e) => { const txt = (await page.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400); console.log('[CELL] E1 ' + width + ' NO .ne-row; page text: ' + txt); await page.screenshot({ path: 'qa/.shots/e1-' + width + '-norow.png' }).catch(() => {}); throw new Error('ENVIRONMENT, not a product verdict: the Calendar tab has no event rows. /news reads the econ snapshot table (lhq_dev_econ_snapshot, key us_high_impact); if its updated_at is older than a day every event is filtered out as past and the tab is empty. Check the snapshot is fresh before reading this as a product miss. (' + String(e).slice(0, 80) + ')'); });
        const m = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('.ne-row')) as HTMLElement[]; const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && getComputedStyle(e).display !== 'none';
          const cols = (el: HTMLElement) => getComputedStyle(el).gridTemplateColumns.split(' ').length; const hdr = all[0];
          return { n: all.length, hdrCols: cols(hdr), colMismatch: all.filter((r) => cols(r) !== cols(hdr)).length, prevVisible: Array.from(document.querySelectorAll('.ne-prev')).some(vis), impVisible: Array.from(document.querySelectorAll('.ne-imp')).some(vis),
            impacts: Array.from(new Set(Array.from(document.querySelectorAll('.ne-imp')).slice(1).filter(vis).map((e) => (e.textContent || '').trim()))), docW: document.documentElement.scrollWidth, winW: window.innerWidth };
        });
        console.log(`[CELL] E1 ${width}: rows=${m.n} cols=${m.hdrCols} mismatch=${m.colMismatch} prevVisible=${m.prevVisible} impactVisible=${m.impVisible} impacts=${JSON.stringify(m.impacts)} docW=${m.docW}/${m.winW}`);
        expect(m.docW, 'the page scrolls sideways').toBeLessThanOrEqual(m.winW); expect(m.colMismatch, 'a row has a different column count than the header').toBe(0);
        if (width < 480) { expect(m.prevVisible || m.impVisible, 'Previous / Impact are visible under 480').toBe(false); expect(m.hdrCols).toBe(4); } else { expect(m.prevVisible && m.impVisible, 'Previous / Impact hidden from 480').toBe(true); expect(m.hdrCols).toBe(6);
          for (const v of m.impacts) expect(['High', 'Medium', '-'], `unexpected impact text ${v}`).toContain(v); }
      } finally { await ctx.close(); }
    });
  }
});
