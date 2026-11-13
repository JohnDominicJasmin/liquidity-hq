/* #2247 (#1263): /arena?coin=<something Arena does not list> still opens BTC, but now says so. PM's five assertions as GitHub-run cells.
 *
 *   U1  /arena?coin=zzzz opens BTC and shows a role=status note naming ZZZZ; its close button is >= 44 px; dismissed, it stays dismissed
 *   U2  /arena?coin=cyber|xaut|gram|nvda opens that coin and shows no note
 *   U3  /arena with no coin parameter shows no note
 *   U4  /arena?coin=%3Cb%3Ex: the note is plain text, no markup
 *   U5  ko, zh, ru, ar at 390 (the row of migration 20261113d injected into /api/labels): the note renders and does not clip, overflow or push the page sideways
 * Signed out, nothing written or billed. */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const note = (page: Page) => page.locator('[role="status"]').filter({ hasText: /./ });
const selected = (page: Page) => page.getByTestId('scanner-trigger').innerText().then(t => t.replace(/\s+/g, ' '));
const noteTexts = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="status"]')).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => /\bdo not list\b|ZZZZ|CYBER|XAUT|GRAM|NVDA|<|>|목록|不在|нет в|لا ندرج/i.test(t)));

test.describe('#2247 unknown coin link note', () => {
  test.describe.configure({ timeout: 150_000 });

  test('U1. an unknown coin opens BTC and says so; the close button is >= 44 px and the dismissal sticks', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena?coin=zzzz'); await page.waitForTimeout(7_000);
      const sel = await selected(page); const n = await noteTexts(page);
      console.log(`[U1] selected="${sel.slice(0, 40)}" notes=${JSON.stringify(n)}`);
      expect(sel, 'Arena did not open BTC').toMatch(/BTC/);
      expect(n.some(t => /ZZZZ/.test(t)), 'no status note names ZZZZ: ' + JSON.stringify(n)).toBe(true);
      const box = await page.locator('[role="status"]').filter({ hasText: /ZZZZ/ }).locator('button').first().boundingBox();
      console.log('[U1] close button box ' + JSON.stringify(box));
      expect(box, 'no close button').not.toBeNull(); expect(box!.width, 'close button narrower than 44 px').toBeGreaterThanOrEqual(44); expect(box!.height, 'close button shorter than 44 px').toBeGreaterThanOrEqual(44);
      await page.locator('[role="status"]').filter({ hasText: /ZZZZ/ }).locator('button').first().click(); await page.waitForTimeout(500);
      expect((await noteTexts(page)).some(t => /ZZZZ/.test(t)), 'the note is still there after the close button').toBe(false);
      // a coin change must not bring it back
      await page.getByTestId('scanner-trigger').locator('div').first().click(); await page.locator('[data-testid^="scanner-row-"]').first().waitFor({ state: 'visible', timeout: 20_000 });
      await page.locator('[data-testid="scanner-row-eth"]').first().click(); await page.waitForTimeout(1500);
      expect((await noteTexts(page)).some(t => /ZZZZ/.test(t)), 'the note came back after a coin change').toBe(false);
    } finally { await ctx.close(); }
  });

  for (const coin of ['cyber', 'xaut', 'gram', 'nvda']) {
    test(`U2. /arena?coin=${coin} opens that coin and shows no note`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/arena?coin=' + coin); await page.waitForTimeout(7_000);
        const sel = await selected(page); const n = await noteTexts(page);
        console.log(`[U2] ${coin} selected="${sel.slice(0, 40)}" notes=${JSON.stringify(n)}`);
        expect(new RegExp(coin, 'i').test(sel), `Arena did not open ${coin}: "${sel}"`).toBe(true);
        expect(n.filter(t => /do not list|opened BTC/i.test(t)), 'a note appeared for a coin Arena offers').toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  test('U3. /arena with no coin parameter shows no note', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try { await gotoGuarded(page, '/arena'); await page.waitForTimeout(7_000); const n = await noteTexts(page); console.log('[U3] notes=' + JSON.stringify(n)); expect(n.filter(t => /do not list|opened BTC/i.test(t))).toEqual([]); } finally { await ctx.close(); }
  });

  test('U4. a markup-looking coin parameter shows plain text, no markup', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena?coin=%3Cb%3Ex'); await page.waitForTimeout(7_000);
      const info = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('[role="status"]')).find(e => /do not list|opened BTC/i.test(e.textContent || '')) as HTMLElement | undefined; return s ? { text: (s.textContent || '').replace(/\s+/g, ' ').trim(), innerBold: s.querySelectorAll('b,i,script,img').length, html: s.innerHTML.slice(0, 200) } : null; });
      console.log('[U4] ' + JSON.stringify(info));
      expect(info, 'no note for an unknown coin').not.toBeNull(); expect(info!.innerBold, 'markup was rendered inside the note').toBe(0);
    } finally { await ctx.close(); }
  });

  /** The row of migration 20261113d for each locale (PROD block), injected into the real /api/labels payload. */
  const rows = (() => { const out: Record<string, string> = {}; const p = 'supabase/migrations/20261113d_labels_arena_unknown_coin_note.sql'; if (!existsSync(p)) return out; const re = /\('ARENA_UNKNOWN_COIN_NOTE','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(p, 'utf8'); let m: RegExpExecArray | null; while ((m = re.exec(t))) out[m[1]] = m[2].replace(/''/g, "'"); return out; })();
  for (const loc of ['ko', 'zh', 'ru', 'ar']) {
    test(`U5. the note in ${loc} at 390 renders and does not clip`, async ({ browser }) => {
      test.skip(!rows[loc], 'migration 20261113d is not in this tree');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage();
      await page.route('**/api/labels*', async (route) => { let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; } let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; } const pl = body as Record<string, unknown>; const labels = (pl.labels ?? pl) as Record<string, unknown>; labels.ARENA_UNKNOWN_COIN_NOTE = rows[loc]; await route.fulfill({ response: res, json: pl }); });
      try {
        // baseline: the same locale and width with NO note, so a sideways scroll can be told apart from the note's own
        await gotoGuarded(page, '/arena?coin=btc'); await page.waitForTimeout(8_000);
        const base = await page.evaluate(() => ({ docSw: document.documentElement.scrollWidth, vw: window.innerWidth, wide: Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map(e => (e.tagName + '.' + String(e.className).slice(0, 40) + ' r=' + Math.round(e.getBoundingClientRect().right))) }));
        console.log(`[U5-baseline] ${loc} ${JSON.stringify(base)}`);
        await gotoGuarded(page, '/arena?coin=zzzz'); await page.waitForTimeout(8_000);
        const g = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('[role="status"]')).find(e => /ZZZZ/.test(e.textContent || '')) as HTMLElement | undefined; if (!s) return null; const b = s.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(s); const lines = new Set(Array.from(r.getClientRects()).filter(x => x.width > 0).map(x => Math.round(x.top))).size; return { text: (s.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120), lines, overflows: s.scrollWidth > s.clientWidth + 1, right: Math.round(b.right), vw: window.innerWidth, docSw: document.documentElement.scrollWidth }; });
        const wideNote = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map(e => (e.tagName + '.' + String(e.className).slice(0, 40) + ' r=' + Math.round(e.getBoundingClientRect().right))));
        console.log(`[U5-wide] ${loc} ${JSON.stringify(wideNote)}`);
        console.log(`[U5] ${loc} ${JSON.stringify(g)}`); await page.screenshot({ path: `qa/.shots/u5-${loc}.png` });
        expect(g, 'the note did not render in ' + loc).not.toBeNull();
        expect(g!.overflows, 'the note overflows its box').toBe(false); expect(g!.right, 'the note runs past the viewport').toBeLessThanOrEqual(g!.vw); expect(g!.docSw, 'the page scrolls sideways').toBeLessThanOrEqual(g!.vw);
      } finally { await ctx.close(); }
    });
  }
});
