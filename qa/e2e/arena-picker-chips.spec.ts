/* #2244 / #1263: the Arena coin picker's category chips live INSIDE the list. The eight assertions of PM's spec (#1263 comment 6853712686), as GitHub-run cells,
 * plus the sign-off shots PM asked for (landing `/` at 390/768/1280 light and dark, and the open picker in three states at the same widths and themes).
 *
 *   P1  the outside tab row is gone; the chips render inside the flyout, under the search box and above the column header, one per category
 *   P2  search "nv" in All: the chip counts update and typing does not change the category; choosing Stocks keeps "nv" and shows NVDA
 *   P3  a letter typed while a chip is focused lands in the search box
 *   P4  Majors + "nv" shows the empty state, offering the category that holds the matches; taking it keeps the search text
 *   P5  the category persists across close and reopen (localStorage key lhq_arena_scanner_cat) and falls back to All when storage is blocked
 *   P6  at 390 the chip row is one line, scrolls sideways, the page does not, chips are >= 32 px and the row >= 44 px
 *   P7  keyboard: search focused on open, Down into the rows, Tab to the chips, arrows between chips, Esc closes and returns focus to the trigger
 *   S   shots (qa/.shots): landing and picker (All; Stocks + "nv"; empty state) at 390/768/1280, light and dark
 * Signed out, nothing written or billed. Hooks per the PR: `.scanner-cat-chip[data-cat]` (aria-pressed) inside `.scanner-cat-row[role=group]`, rows scroller
 * `.scanner-flyout-rows`, search `input.clipped-row-search`, rows `[data-testid^="scanner-row-"]`, trigger `[data-testid="scanner-trigger"]`. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const DIR = 'qa/.shots';
const CATS = ['all', 'majors', 'alts', 'defi', 'meme', 'stocks', 'etfs', 'commodities'];
const KEY = 'lhq_arena_scanner_cat';
const chip = (page: Page, cat: string) => page.locator(`.scanner-cat-chip[data-cat="${cat}"]`).first();
const rowsSel = '[data-testid^="scanner-row-"]';

async function open(page: Page, theme: 'dark' | 'light' = 'dark') {
  void theme;
  await gotoGuarded(page, '/arena');
  await page.waitForTimeout(8_000);   // the market read fills the counts and rows
  const trig = page.getByTestId('scanner-trigger');
  await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 15_000 });
}
async function ctxFor(browser: import('@playwright/test').Browser, width: number, theme: 'dark' | 'light' = 'dark', blockStorage = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([t, block, key]) => {
    try { localStorage.setItem('theme', t as string); } catch { /* private */ }
    if (block) {
      const g = Storage.prototype.getItem, s = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k: string) { if (k === key) throw new Error('blocked'); return g.call(this, k); };
      Storage.prototype.setItem = function (k: string, v: string) { if (k === key) throw new Error('blocked'); return s.call(this, k, v); };
    }
  }, [theme, blockStorage, KEY] as [string, boolean, string]);
  return ctx;
}
const pressed = (page: Page) => page.locator('.scanner-cat-chip[aria-pressed="true"]').evaluateAll(els => els.map(e => e.getAttribute('data-cat')));
const ids = (page: Page) => page.locator(rowsSel).evaluateAll(els => els.map(e => (e.getAttribute('data-testid') ?? '').replace('scanner-row-', '')));
const countOf = async (page: Page, cat: string) => {
  const t = (await chip(page, cat).innerText()).replace(/\s+/g, ' ');
  const m = t.match(/(\d[\d,]*)\s*$/); return { text: t, n: m ? Number(m[1].replace(/,/g, '')) : null };
};

test.describe('#2244 category chips inside the coin picker', () => {
  test.describe.configure({ timeout: 180_000 });

  test('P1. the outside tab row is gone; eight chips sit inside the flyout between the search box and the column header', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(6_000);
      const outside = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => /^\s*(All|Majors|Alts|DeFi\/AI|Meme|Stocks|ETFs|Commodities & FX)\b/.test(b.textContent || '') && !b.closest('.scanner-flyout') && !b.closest('[data-testid="scanner-trigger"]')).map(b => (b.textContent || '').trim().slice(0, 20)));
      console.log('[P1] category-labelled buttons outside the picker: ' + JSON.stringify(outside));
      await open(page);
      const order = await page.evaluate(() => {
        const fly = document.querySelector('.scanner-flyout'); const row = fly?.querySelector('.scanner-cat-row') as HTMLElement | null;
        const search = fly?.querySelector('input.clipped-row-search'); const header = fly?.querySelector('.scanner-flyout-grid'); const firstRow = fly?.querySelector('[data-testid^="scanner-row-"]');
        const before = (a?: Element | null, b?: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { hasRow: !!row, role: row?.getAttribute('role') ?? null, searchBeforeChips: before(search, row), chipsBeforeHeader: before(row, header), chipsBeforeRows: before(row, firstRow),
          cats: Array.from(fly?.querySelectorAll('.scanner-cat-chip') ?? []).map(c => c.getAttribute('data-cat')) };
      });
      console.log('[P1] ' + JSON.stringify(order));
      await page.screenshot({ path: `${DIR}/p1-picker.png` });
      expect(order.hasRow, 'no .scanner-cat-row inside the flyout').toBe(true);
      expect(order.cats, 'the chip set differs from the eight categories').toEqual(CATS);
      expect(order.searchBeforeChips && order.chipsBeforeHeader && order.chipsBeforeRows, 'the chip row is not between the search box and the column header').toBe(true);
      expect(outside, 'a category button still sits outside the picker').toEqual([]);
    } finally { await ctx.close(); }
  });

  test('P2. search "nv" in All updates the counts and keeps the category; choosing Stocks keeps "nv" and shows NVDA', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await open(page);
      const before = await countOf(page, 'stocks');
      await page.locator('input.clipped-row-search').first().fill('nv'); await page.waitForTimeout(600);
      const after = await countOf(page, 'stocks'); const pAfterTyping = await pressed(page);
      console.log(`[P2] stocks chip before="${before.text}" after typing nv="${after.text}" pressed after typing=${JSON.stringify(pAfterTyping)}`);
      expect(pAfterTyping, 'typing changed the category').toEqual(['all']);
      expect(before.n, 'no count on the Stocks chip').not.toBeNull(); expect(after.n, 'no count after typing').not.toBeNull();
      expect(after.n!, 'typing nv did not narrow the Stocks count').toBeLessThan(before.n!);
      await chip(page, 'stocks').click(); await page.waitForTimeout(600);
      const value = await page.locator('input.clipped-row-search').first().inputValue();
      const rows = await ids(page);
      console.log(`[P2] after clicking Stocks: search="${value}" rows=${rows.slice(0, 8).join(',')}`);
      await page.screenshot({ path: `${DIR}/p2-stocks-nv.png` });
      expect(value, 'choosing a category cleared the search').toBe('nv');
      expect(rows.some(r => /nvda/i.test(r)), 'NVDA is not shown under Stocks with "nv" typed: ' + rows.slice(0, 10).join(',')).toBe(true);
    } finally { await ctx.close(); }
  });

  test('P3. a letter typed while a chip is focused lands in the search box', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await open(page);
      await chip(page, 'majors').focus();
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-cat')), 'the chip did not take focus').toBe('majors');
      await page.keyboard.type('q'); await page.waitForTimeout(300);
      const v = await page.locator('input.clipped-row-search').first().inputValue();
      const active = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? '');
      console.log(`[P3] search="${v}" active=${active}`);
      expect(v, 'the typed letter did not reach the search box').toBe('q');
    } finally { await ctx.close(); }
  });

  test('P4. Majors + "nv" shows the empty state with a switch to the category that holds the matches; the search text survives it', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await open(page);
      await page.locator('input.clipped-row-search').first().fill('nv'); await chip(page, 'majors').click(); await page.waitForTimeout(600);
      const text = (await page.locator('.scanner-flyout').innerText()).replace(/\s+/g, ' ');
      const empty = text.match(/No match in[^.]*\.[^.]*\./i);
      console.log(`[P4] empty state: ${empty ? empty[0] : '(none)'}; rows=${(await ids(page)).length}`);
      await page.screenshot({ path: `${DIR}/p4-empty.png` });
      expect(empty, 'no "No match in X. N in Y." line for Majors + nv: ' + text.slice(0, 200)).not.toBeNull();
      const sw = page.locator('.scanner-flyout button').filter({ hasText: /^\s*(Show|Switch|See|Go)|in (All|Stocks)|\bStocks\b.*\d|\bAll\b.*\d/i }).filter({ hasNot: page.locator('.scanner-cat-chip') }).first();
      /* the empty state's switch button carries the chip class too (class scanner-cat-chip, no data-cat), so it is the chip WITHOUT a data-cat */
      const sb = page.locator('.scanner-flyout .scanner-cat-chip:not([data-cat])');
      const cands = await sb.allInnerTexts(); console.log('[P4] non-chip buttons in the flyout: ' + JSON.stringify(cands.slice(0, 6)));
      expect(cands.length, 'no switch button in the empty state').toBeGreaterThan(0);
      void sw;
      await sb.first().click(); await page.waitForTimeout(600);
      const v = await page.locator('input.clipped-row-search').first().inputValue(); const p = await pressed(page);
      console.log(`[P4] after the switch: search="${v}" pressed=${JSON.stringify(p)} rows=${(await ids(page)).slice(0, 5).join(',')}`);
      expect(v, 'taking the switch cleared the search').toBe('nv'); expect(p[0], 'the switch left the category unchanged').not.toBe('majors');
    } finally { await ctx.close(); }
  });

  test('P5. the category persists across close and reopen, and falls back to All when storage is blocked', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await open(page); await chip(page, 'stocks').click(); await page.waitForTimeout(400);
      await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(500);
      const stored = await page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return 'ERR'; } }, KEY);
      await page.getByTestId('scanner-trigger').locator('div').first().click(); await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 10_000 });
      const p1 = await pressed(page); console.log(`[P5] stored=${stored} pressed after reopen=${JSON.stringify(p1)}`);
      expect(p1, 'the category did not survive close and reopen').toEqual(['stocks']);
      expect(stored, 'the choice is not in localStorage under the documented key').toBe('stocks');
      // reload: still remembered
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000);
      await page.getByTestId('scanner-trigger').locator('div').first().click(); await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 15_000 });
      const p2 = await pressed(page); console.log(`[P5] after a reload: ${JSON.stringify(p2)}`);
      expect(p2, 'the category did not survive a reload').toEqual(['stocks']);
    } finally { await ctx.close(); }
    const ctx2 = await ctxFor(browser, 1280, 'dark', true); const page2 = await ctx2.newPage();
    try {
      await open(page2);
      const p = await pressed(page2); console.log(`[P5] storage BLOCKED: pressed=${JSON.stringify(p)}`);
      await chip(page2, 'stocks').click(); await page2.waitForTimeout(500);
      expect(p, 'with storage blocked the picker did not default to All').toEqual(['all']);
      expect(await pressed(page2), 'with storage blocked choosing a chip still has to work').toEqual(['stocks']);
    } finally { await ctx2.close(); }
  });

  test('P6. at 390 the chip row is one line and scrolls sideways, the page does not, chips are >= 32 px and the row >= 44 px', async ({ browser }) => {
    const ctx = await ctxFor(browser, 390); const page = await ctx.newPage();
    try {
      await open(page);
      const m = await page.evaluate(() => {
        const row = document.querySelector('.scanner-cat-row') as HTMLElement | null; if (!row) return null;
        const chips = Array.from(row.querySelectorAll('.scanner-cat-chip')) as HTMLElement[];
        const tops = Array.from(new Set(chips.map(c => Math.round(c.getBoundingClientRect().top))));
        const cs = getComputedStyle(row); const rb = row.getBoundingClientRect(); const rowsEl = document.querySelector('.scanner-flyout-rows') as HTMLElement | null;
        return { chips: chips.length, lines: tops.length, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, overflowX: cs.overflowX, rowHeight: Math.round(rb.height),
          minChipHeight: Math.round(Math.min(...chips.map(c => c.getBoundingClientRect().height))), docSw: document.documentElement.scrollWidth, iw: window.innerWidth,
          listMaxHeight: rowsEl ? getComputedStyle(rowsEl).maxHeight : null, vh: window.innerHeight };
      });
      console.log('[P6] ' + JSON.stringify(m)); await page.screenshot({ path: `${DIR}/p6-390.png` });
      expect(m, 'no chip row').not.toBeNull();
      expect(m!.lines, 'the chips wrap onto more than one line').toBe(1);
      expect(m!.scrollWidth, 'the chip row does not scroll sideways (nothing to scroll to)').toBeGreaterThan(m!.clientWidth);
      expect(['auto', 'scroll']).toContain(m!.overflowX);
      expect(m!.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(m!.iw);
      expect(m!.minChipHeight, 'a chip is shorter than 32 px').toBeGreaterThanOrEqual(32);
      expect(m!.rowHeight, 'the chip row is shorter than 44 px').toBeGreaterThanOrEqual(44);
    } finally { await ctx.close(); }
  });

  test('P7. keyboard: search focused on open, Down into the rows, Tab to the chips, arrows between chips, Esc closes and focus returns to the trigger', async ({ browser }) => {
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage();
    try {
      await open(page);
      const act = () => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { tag: a?.tagName ?? '', cls: a?.className?.toString().slice(0, 40) ?? '', cat: a?.getAttribute('data-cat') ?? null, testid: a?.getAttribute('data-testid') ?? null, inTrigger: !!a?.closest('[data-testid="scanner-trigger"]') && !a?.closest('.scanner-flyout') }; });
      const a0 = await act(); console.log('[P7] on open: ' + JSON.stringify(a0));
      expect(a0.tag, 'the search box does not have focus on open').toBe('INPUT');
      await page.keyboard.press('ArrowDown'); const a1 = await act(); console.log('[P7] after Down: ' + JSON.stringify(a1));
      expect(a1.testid ?? '', 'Down did not move into the rows').toMatch(/^scanner-row-/);
      await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150);
      const back = await act(); console.log('[P7] after Up: ' + JSON.stringify(back));
      await page.locator('input.clipped-row-search').first().focus(); await page.keyboard.press('Tab'); const a2 = await act(); console.log('[P7] after Tab from search: ' + JSON.stringify(a2));
      expect(a2.cat, 'Tab from the search box did not land on a chip').not.toBeNull();
      const first = a2.cat; await page.keyboard.press('ArrowRight'); const a3 = await act(); console.log('[P7] after Right: ' + JSON.stringify(a3));
      expect(a3.cat, 'Right arrow did not move to the next chip').not.toBeNull(); expect(a3.cat).not.toBe(first);
      await page.keyboard.press('Home'); const a4 = await act(); expect(a4.cat, 'Home did not go to the first chip').toBe('all');
      await page.keyboard.press('End'); const a5 = await act(); expect(a5.cat, 'End did not go to the last chip').toBe('commodities');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      const closed = !(await page.locator('.scanner-flyout').isVisible().catch(() => false)); const a6 = await act(); console.log(`[P7] after Esc: closed=${closed} ${JSON.stringify(a6)}`);
      expect(closed, 'Esc did not close the list').toBe(true);
      expect(a6.inTrigger, 'focus did not return to the trigger').toBe(true);
    } finally { await ctx.close(); }
  });
});

test.describe('#2244 sign-off shots', () => {
  test.describe.configure({ timeout: 240_000 });
  for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280]) {
    test(`S. shots at ${width}px ${theme}: landing and the picker in three states`, async ({ browser }) => {
      mkdirSync(DIR, { recursive: true });
      const ctx = await ctxFor(browser, width, theme); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/'); await page.waitForTimeout(5_000);
        await page.screenshot({ path: `${DIR}/s-landing-${width}-${theme}.png` });
        await open(page);
        await page.screenshot({ path: `${DIR}/s-picker-all-${width}-${theme}.png` });
        await page.locator('input.clipped-row-search').first().fill('nv'); await chip(page, 'stocks').click(); await page.waitForTimeout(700);
        await page.screenshot({ path: `${DIR}/s-picker-stocks-nv-${width}-${theme}.png` });
        await chip(page, 'majors').click(); await page.waitForTimeout(700);
        await page.screenshot({ path: `${DIR}/s-picker-empty-${width}-${theme}.png` });
        const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        console.log(`[S] ${width} ${theme} doc=${JSON.stringify(sw)}`);
        expect(sw.sw, 'the page scrolls sideways').toBeLessThanOrEqual(sw.iw);
      } finally { await ctx.close(); }
    });
  }
});
