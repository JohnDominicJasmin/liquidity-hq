/* RE-PINNED 2026-11-18 for #2555 (owner order "no failing data": real value, last good, or HIDE the row): the landing no longer prints "Unavailable" or a dash for a reading that failed; the cell or row is LEFT OUT. L1/L2/L3/L5 below now pin that; L4 (a value when the read answers) and the shots are unchanged.
 * #2246 (#1651 follow-ups), as it was: the landing page's missing readings say which kind of missing, once, in the visitor's language, and the live-read card has no bare dash.
 *
 *   L1  ticker, Binance refused: a coin with NEITHER a price nor a 24H change (HYPE: the Bybit stub does not carry it) says "Unavailable" ONCE, never "n/a n/a", never a dash
 *   L2  live-read card: OI trend, CB prem and OI 1h each read a value, an ellipsis or "Unavailable"; no bare dash; OI 1h has no second dash as a note
 *   L3  every source fails: all three rows say "Unavailable"
 *   L4  CB prem shows a +/- percentage when the Coinbase read answers
 *   L5  /ko, /zh, /ru: the ticker word is the locale's own
 *   S   shots of / at 390/768/1280 in light and dark, and of /ko /zh /ru at 390 (qa/.shots)
 * Entry / Stop / Target keep the design's em dash by design and are not asserted. Signed out, nothing written or billed; the Bybit and Coinbase answers are stubs. */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
const WORDS: Record<string, string> = { en: 'Unavailable', ko: '이용 불가', zh: '不可用', ru: 'Недоступно', ar: 'غير متاح' };

async function setup(ctx: BrowserContext, opts: { refuse?: boolean; failAll?: boolean; coinbase?: boolean } = {}) {
  if (opts.refuse !== false) { await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' })); await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); }); }
  if (opts.failAll) {
    await ctx.route(/\/api\/(proxy|market|coinbase-price)/, r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }));
  } else {
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
    if (opts.coinbase) await ctx.route(/\/api\/coinbase-price/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: 69010, usdtUsd: 1 }) }));
  }
}
const rows = (page: Page) => page.evaluate(() => {
  const labels = ['OI trend', 'CB prem', 'OI 1h'] as const; const out: Record<string, string | null> = {};
  for (const l of labels) {
    const el = Array.from(document.querySelectorAll('span,div,td,dt,p')).find(e => (e.children.length === 0) && (e.textContent || '').trim() === l) as HTMLElement | undefined;
    const row = el?.parentElement as HTMLElement | null | undefined;
    out[l] = row ? (row.innerText || '').replace(l, '').replace(/\s+/g, ' ').trim() : null;
  }
  return out;
});
const ticker = (page: Page, coin: string) => page.evaluate((c) => { const cells = Array.from(document.querySelectorAll('.lpt-ticker > div')) as HTMLElement[]; const x = cells.find(e => (e.innerText || '').replace(/\s+/g, ' ').trim().split(' ')[0] === c); return x ? (x.innerText || '').replace(/\s+/g, ' ').trim() : null; }, coin);
const count = (s: string, w: string) => s.split(w).length - 1;

test.describe('#2246 landing honest states', () => {
  test.describe.configure({ timeout: 150_000 });

  for (const width of [1280, 390]) {
    test(`L1. ticker at ${width}px: a coin with neither price nor change is LEFT OUT (no Unavailable, no n/a, no dash); the coins with a quote show it`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await setup(ctx); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/');
        await expect.poll(async () => (await page.evaluate(() => document.querySelectorAll('.lpt-ticker > div').length)), { timeout: 45_000, message: 'CONTROL: the ticker never rendered' }).toBeGreaterThanOrEqual(3);
        await page.waitForTimeout(6_000);
        const hype = await ticker(page, 'HYPE'); const all = await page.evaluate(() => Array.from(document.querySelectorAll('.lpt-ticker > div')).map(e => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()));
        const naNa = all.filter(t => /n\/a\s+n\/a/i.test(t)); const dash = all.filter(t => /(^|\s)-(\s|$)/.test(t)); const unav = all.filter(t => /unavailable/i.test(t));
        console.log(`[L1] ${width} HYPE=${JSON.stringify(hype)} cells=${all.length} unavailable=${unav.length} n/a n/a=${naNa.length} bare dash=${dash.length} sample=${JSON.stringify(all.slice(0, 6))}`);
        /* HYPE has no quote in this stub: after #2555 its cell is not drawn at all. If a quote ever exists for it the cell may show it, but never a word or a dash. */
        if (hype !== null) expect(/[+−-]?\d/.test(hype), 'HYPE is drawn without a value: "' + hype + '"').toBe(true);
        expect(unav, 'a ticker cell says Unavailable').toEqual([]); expect(naNa, 'a cell reads n/a n/a').toEqual([]); expect(dash, 'a cell holds a bare dash').toEqual([]);
        for (const c of ['BTC', 'ETH', 'SOL']) { const v = await ticker(page, c); expect(v && /\d/.test(v), c + ' shows no value: "' + v + '"').toBeTruthy(); }
      } finally { await ctx.close(); }
    });
  }

  test('L2. live-read card rows: a value or an ellipsis while loading; a row with no reading is LEFT OUT; never Unavailable, never a bare dash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await setup(ctx, { coinbase: true }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(24_000);
      const r = await rows(page); console.log('[L2] ' + JSON.stringify(r));
      expect(Object.values(r).filter((v) => v !== null).length, 'CONTROL: no live-read row was drawn at all (the card did not render)').toBeGreaterThan(0);
      for (const k of ['OI trend', 'CB prem', 'OI 1h']) {
        if (r[k] === null) continue;   // a row with no reading is hidden (#2555)
        expect(/^([+−-]?\d[\d.,]*%?|…|\.\.\.)(\s.*)?$/.test(r[k]!), `${k} reads "${r[k]}"`).toBe(true);
        expect(/unavailable/i.test(r[k]!), `${k} says Unavailable: "${r[k]}"`).toBe(false);
        expect(/(^|\s)[-—–](\s|$)/.test(r[k]!), `${k} holds a bare dash: "${r[k]}"`).toBe(false);
      }
    } finally { await ctx.close(); }
  });

  test('L3. every source fails: the three live-read rows are LEFT OUT, and nothing on the page says Unavailable', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await setup(ctx, { failAll: true }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(30_000);
      const r = await rows(page); console.log('[L3] ' + JSON.stringify(r));
      for (const k of ['OI trend', 'CB prem', 'OI 1h']) {
        if (r[k] === null) continue;   // hidden: the intended state
        expect(/unavailable/i.test(r[k]!) || /(^|\s)[-—–](\s|$)/.test(r[k]!), `${k} after every read failed shows a word or a dash instead of being left out: "${r[k]}"`).toBe(false);
      }
      const body = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
      expect(/OI trend[^|]{0,30}unavailable|CB prem[^|]{0,30}unavailable|OI 1h[^|]{0,30}unavailable/i.test(body), 'a live-read label is followed by Unavailable').toBe(false);
    } finally { await ctx.close(); }
  });

  test('L4. CB prem shows a +/- percentage when the Coinbase read answers', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await setup(ctx, { coinbase: true }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(18_000);
      const r = await rows(page); console.log('[L4] CB prem=' + JSON.stringify(r['CB prem']));
      expect(r['CB prem'], 'CB prem does not show a signed percentage with three decimals (the dashboard format)').toMatch(/^[+−-]?\d+\.\d{3}%/);
      /* Coinbase answers 69010 against a Bybit-seeded BTC of 69000: a premium of about +0.014%. The exact digits depend on which BTC price the app compares against, so the value is bounded, not pinned. */
      const v = Number((r['CB prem'] ?? '').replace('−', '-').match(/[+-]?\d+\.\d+/)?.[0] ?? 'NaN');
      expect(Math.abs(v), `CB prem is ${v}, far from the ~0.014% the stubbed prices imply`).toBeLessThan(0.1);
    } finally { await ctx.close(); }
  });

  for (const loc of ['ko', 'zh', 'ru']) {
    test(`L5. /${loc}: a coin with no quote is LEFT OUT of the ticker, and the locale's own unavailable word is not shown`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); await setup(ctx); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/' + loc);
        await expect.poll(async () => (await page.evaluate(() => document.querySelectorAll('.lpt-ticker > div').length)), { timeout: 45_000, message: 'CONTROL: the ticker never rendered' }).toBeGreaterThanOrEqual(3);
        await page.waitForTimeout(6_000);
        const hype = await ticker(page, 'HYPE'); const all = await page.evaluate(() => Array.from(document.querySelectorAll('.lpt-ticker > div')).map(e => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()));
        console.log(`[L5] ${loc} HYPE=${JSON.stringify(hype)} url=${page.url()} cells=${all.length}`);
        if (hype !== null) expect(/[+−-]?\d/.test(hype), 'HYPE is drawn without a value: "' + hype + '"').toBe(true);
        expect(all.filter((t) => t.includes(WORDS[loc]) || /n\/a|N\/A|unavailable/i.test(t)), 'a ticker cell shows an unavailable word').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2246 sign-off shots', () => {
  test.describe.configure({ timeout: 150_000 });
  mkdirSync('qa/.shots', { recursive: true });
  for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280]) {
    test(`S. / at ${width}px ${theme}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private */ } }, theme);
      await setup(ctx, { coinbase: true }); const page = await ctx.newPage();
      try { await gotoGuarded(page, '/'); await page.waitForTimeout(16_000); await page.screenshot({ path: `qa/.shots/l-landing-${width}-${theme}.png` }); const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth })); expect(sw.s, 'sideways scroll').toBeLessThanOrEqual(sw.w); } finally { await ctx.close(); }
    });
  }
  for (const loc of ['ko', 'zh', 'ru']) {
    test(`S. /${loc} at 390px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); await setup(ctx, { coinbase: true }); const page = await ctx.newPage();
      try { await gotoGuarded(page, '/' + loc); await page.waitForTimeout(16_000); await page.screenshot({ path: `qa/.shots/l-landing-${loc}-390.png` }); } finally { await ctx.close(); }
    });
  }
});
