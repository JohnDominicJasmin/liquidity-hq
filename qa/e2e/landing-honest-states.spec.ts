/* #2246 (#1651 follow-ups): the landing page's missing readings say which kind of missing, once, in the visitor's language, and the live-read card has no bare dash.
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
    test(`L1. ticker at ${width}px: a coin with neither price nor change says Unavailable once`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await setup(ctx); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/'); await page.waitForTimeout(16_000);
        const hype = await ticker(page, 'HYPE'); const all = await page.evaluate(() => Array.from(document.querySelectorAll('.lpt-ticker > div')).map(e => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()));
        const naNa = all.filter(t => /n\/a\s+n\/a/i.test(t)); const dash = all.filter(t => /(^|\s)-(\s|$)/.test(t));
        console.log(`[L1] ${width} HYPE="${hype}" cells=${all.length} "n/a n/a"=${naNa.length} bare dash=${dash.length} sample=${JSON.stringify(all.slice(0, 6))}`);
        expect(hype, 'the HYPE cell was not found').not.toBeNull();
        expect(count(hype!, 'Unavailable'), 'HYPE does not say Unavailable exactly once: "' + hype + '"').toBe(1);
        expect(naNa, 'a cell still reads n/a n/a').toEqual([]); expect(dash, 'a cell holds a bare dash').toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  test('L2. live-read card rows: a value, an ellipsis or Unavailable; no bare dash, no second dash in OI 1h', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await setup(ctx, { coinbase: true }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(18_000);
      const r = await rows(page); console.log('[L2] ' + JSON.stringify(r));
      for (const k of ['OI trend', 'CB prem', 'OI 1h']) {
        expect(r[k], k + ' row not found').not.toBeNull();
        expect(/^([+−-]?\d[\d.,]*%?|…|Unavailable|\.\.\.)(\s.*)?$/.test(r[k]!), `${k} reads "${r[k]}"`).toBe(true);
        expect(/(^|\s)[-—–](\s|$)/.test(r[k]!), `${k} holds a bare dash: "${r[k]}"`).toBe(false);
      }
    } finally { await ctx.close(); }
  });

  test('L3. every source fails: OI trend, CB prem and OI 1h all say Unavailable', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await setup(ctx, { failAll: true }); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(30_000);
      const r = await rows(page); console.log('[L3] ' + JSON.stringify(r));
      for (const k of ['OI trend', 'CB prem', 'OI 1h']) expect(r[k], `${k} after every read failed`).toMatch(/Unavailable/);
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
    test(`L5. /${loc}: the ticker word is the locale's own`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); await setup(ctx); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/' + loc); await page.waitForTimeout(16_000);
        const hype = await ticker(page, 'HYPE'); console.log(`[L5] ${loc} HYPE="${hype}" url=${page.url()}`);
        expect(hype, 'HYPE cell not found').not.toBeNull();
        expect(count(hype!, WORDS[loc]), `the ${loc} word "${WORDS[loc]}" is not shown once: "${hype}"`).toBe(1);
        expect(/n\/a|N\/A/i.test(hype!), 'an English n/a is left').toBe(false);
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
