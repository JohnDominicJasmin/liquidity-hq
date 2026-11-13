/* #2253 (#1263): the scanner list at 390 in ko, zh, ru, ar, en, with Binance refused. PM's three cells:
 *   N1  price AND 24h both gone: the price cell says the narrow wording ("Нет данных" / "No data") once; the 24h and vs-BTC cells are EMPTY
 *   N2  price present, 24h missing: the 24h cell says the narrow wording, on the space, inside its own cell (en, ru)
 *   N3  docSw = the viewport in all five locales, and no abbreviation (n/a, N/A, н/д, غ/م) anywhere in the list
 * The row text of ar/ko/zh/ru comes from migration 20261113c (the PROD block, the values PM will write), injected into the real /api/labels payload.
 * Signed out, nothing written or billed. */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'] as const;
const FILE = 'supabase/migrations/20261113c_labels_scanner_unavailable_cells.sql';
const ROWS: Record<string, Record<string, string>> = (() => { const out: Record<string, Record<string, string>> = {}; if (!existsSync(FILE)) return out; const re = /\('([A-Z0-9_]+)','(ko|zh|ru|ar)','((?:[^']|'')*)'\)/g; const t = readFileSync(FILE, 'utf8'); let m: RegExpExecArray | null; while ((m = re.exec(t))) (out[m[2]] ??= {})[m[1]] = m[3].replace(/''/g, "'"); return out; })();
const NARROW = (loc: string) => loc === 'en' ? 'No data' : ROWS[loc]?.ARENA_SCANNER_UNAVAILABLE_NARROW;
const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const ABBREV = /(^|[\s>])(n\/a|н\/д|غ\/م)(?=$|[\s<.,])/i;

async function setup(page: Page, loc: string, hypeNoChange: boolean) {
  await page.route('**/api/labels*', async (route) => {
    let res; try { res = await route.fetch(); } catch { try { await route.continue(); } catch { /* gone */ } return; }
    let body: unknown; try { body = await res.json(); } catch { await route.fulfill({ response: res }); return; }
    const pl = body as Record<string, unknown>; const labels = (pl.labels ?? pl) as Record<string, unknown>;
    for (const [k, v] of Object.entries(ROWS[loc] ?? {})) labels[k] = v;
    await route.fulfill({ response: res, json: pl });
  });
  await page.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await page.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  if (hypeNoChange) {
    const t = (symbol: string, last: string, pct: string) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' });
    await page.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [t('BTCUSDT', '69000', '0.01'), t('ETHUSDT', '3500', '0.012'), t('HYPEUSDT', '42.5', '')] } }) }));
  }
}
async function openList(page: Page) {
  const trig = page.getByTestId('scanner-trigger'); await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('.scanner-flyout').waitFor({ state: 'visible', timeout: 20_000 });
}
const cells = (page: Page, id: string) => page.evaluate((i) => {
  const r = document.querySelector(`[data-testid="scanner-row-${i}"]`); if (!r) return null;
  const one = (el: Element | undefined) => { if (!el) return null; const h = el as HTMLElement; const rg = document.createRange(); rg.selectNodeContents(h); const lines = new Set(Array.from(rg.getClientRects()).filter(x => x.width > 0).map(x => Math.round(x.top))).size; const b = h.getBoundingClientRect(); return { text: (h.innerText || '').replace(/\s+/g, ' ').trim(), lines, w: Math.round(b.width), overflows: h.scrollWidth > h.clientWidth + 1 }; };
  return { price: one(r.children[1]), h24: one(r.children[2]), vsbtc: one(r.children[3]), docSw: document.documentElement.scrollWidth, vw: window.innerWidth, listText: (document.querySelector('.scanner-flyout') as HTMLElement | null)?.innerText ?? '' };
}, id);

for (const loc of LOCALES) {
  test.describe(`#2253 scanner at 390 in ${loc}`, () => {
    test.describe.configure({ timeout: 200_000 });

    test(`N1+N3. price and 24h both gone: one narrow word in the price cell, 24h and vs BTC empty, no abbreviation, page 390 wide (${loc})`, async ({ browser }) => {
      test.skip(loc !== 'en' && !NARROW(loc), 'migration 20261113c has no NARROW row in this tree');
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage(); await setup(page, loc, false);
      try {
        await gotoGuarded(page, '/arena'); await page.waitForTimeout(16_000); await openList(page);
        const c = await cells(page, 'anthropic'); console.log(`[N1] ${loc} ${JSON.stringify({ ...c, listText: undefined })}`);
        expect(c, 'row anthropic not found').not.toBeNull();
        expect(c!.price!.text, `price cell in ${loc}`).toBe(NARROW(loc));
        expect(c!.h24!.text, '24h cell should be empty').toBe(''); expect(c!.vsbtc!.text, 'vs BTC cell should be empty').toBe('');
        expect(c!.price!.overflows, 'price cell overflows').toBe(false);
        expect(ABBREV.test(c!.listText), 'an abbreviation is in the list: ' + (c!.listText.match(ABBREV) ?? [''])[0]).toBe(false);
        expect(c!.docSw, 'page scrolls sideways').toBeLessThanOrEqual(c!.vw);
      } finally { await ctx.close(); }
    });
  });
}

for (const loc of ['en', 'ru']) {
  test(`N2. price present, 24h missing: the 24h cell says the narrow wording inside its own cell (${loc})`, async ({ browser }) => {
    test.skip(loc !== 'en' && !NARROW(loc), 'migration 20261113c has no NARROW row in this tree');
    test.setTimeout(200_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
    const page = await ctx.newPage(); await setup(page, loc, true);
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(16_000); await openList(page);
      const c = await cells(page, 'hype'); console.log(`[N2] ${loc} ${JSON.stringify({ ...c, listText: undefined })}`);
      expect(c, 'row hype not found').not.toBeNull();
      expect(c!.price!.text, 'price cell should show the seeded price').toMatch(/42\.5/);
      expect(c!.h24!.text, `24h cell in ${loc}`).toBe(NARROW(loc));
      expect(c!.h24!.overflows, '24h cell overflows its box').toBe(false);
      expect(c!.docSw, 'page scrolls sideways').toBeLessThanOrEqual(c!.vw);
    } finally { await ctx.close(); }
  });
}
