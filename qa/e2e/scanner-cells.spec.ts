/* #2245 (#1263): the Arena scanner's price / 24H / vs BTC / STATUS cells. PM's five cells, as GitHub-run cells, with Binance REFUSED on purpose (the dev/staging condition: the
 * Binance proxy reads answer 429 and every Binance socket closes), so the result does not depend on which addresses the runner is allowed to reach.
 *
 *   K1  FET, COPPER, NATGAS, XPD, XPT, OURA, STRC and HYPE show a price (and a 24H) from the backup / the Bybit seed, never "-", "Unavailable" or the in-flight ellipsis
 *   K2  ANTHROPIC, OPENAI, MOONSHOT, DIS, FRHC, PAYP and HK0625/0700/0992/1810 read "Unavailable" with a note, and NO price cell anywhere in the list is a bare "-"
 *   K3  while the reads are in flight an unpriced row shows the ellipsis, never "Unavailable"; and the ellipsis does not persist past the capped retry
 *   K4  STATUS reads "No signals" instead of "n/a"
 *   K5  the backup is asked only for coins that still lack a price (HYPE, which Bybit seeds, is not asked for). NOT SHOWN: the Binance-healthy case itself (a runner cannot be made a
 *       Binance-allowed address); that stays a check on production after release.
 * Signed out, nothing written or billed. The Hyperliquid backup is the app's own server route calling a real public API. */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { gotoGuarded } from './_shared';

const BN_PROXY = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const PRICED = ['hype', 'fet', 'copper', 'natgas', 'xpd', 'xpt', 'oura', 'strc'];
const UNAVAILABLE = ['anthropic', 'openai', 'moonshot', 'dis', 'frhc', 'payp', 'hk0625', 'hk0700', 'hk0992', 'hk1810'];

async function refuseBinance(ctx: BrowserContext, log?: { bn: number[]; backup: string[] }) {
  await ctx.route(BN_PROXY, async (route) => { log?.bn.push(Date.now()); await route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }); });
  await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  if (log) await ctx.route(/\/api\/market\/price-backup/, async (route) => { log.backup.push(new URL(route.request().url()).searchParams.get('coins') ?? ''); await route.continue(); });
}
async function openList(page: Page) {
  const trig = page.getByTestId('scanner-trigger');
  await trig.waitFor({ state: 'visible', timeout: 60_000 });
  if (!(await page.locator('[data-testid^="scanner-row-"]').first().isVisible().catch(() => false))) await trig.locator('div').first().click();
  await page.locator('[data-testid^="scanner-row-"]').first().waitFor({ state: 'visible', timeout: 20_000 });
}
const read = (page: Page) => page.evaluate(() => {
  const out: Record<string, { price: string; h24: string; vsbtc: string; status: string; score: string; title: string }> = {};
  for (const r of Array.from(document.querySelectorAll('[data-testid^="scanner-row-"]')) as HTMLElement[]) {
    const k = Array.from(r.children) as HTMLElement[]; const t = (i: number) => (k[i]?.textContent ?? '').trim();
    out[r.getAttribute('data-testid')!.replace('scanner-row-', '')] = { price: t(1), h24: t(2), vsbtc: t(3), status: t(4), score: t(5), title: (k[1]?.getAttribute('title') ?? '') + '|' + (k[1]?.getAttribute('aria-label') ?? '') + '|' + (k[1]?.querySelector('[title]')?.getAttribute('title') ?? '') };
  }
  return out;
});
const isValue = (s: string) => /^[^\d]{0,3}[\d,]+(\.\d+)?/.test(s) && !/unavail|…|^-$/i.test(s);

test.describe('#2245 scanner cells with Binance refused', () => {
  test.describe.configure({ timeout: 200_000 });

  test('K1+K2+K4. backed rows show a price; unproven rows say Unavailable; no bare dash; STATUS says No signals', async ({ browser }) => {
    const log = { bn: [] as number[], backup: [] as string[] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await refuseBinance(ctx, log);
    /* THE BYBIT BULK READ IS STUBBED so HYPE's seed can be seen: in a locally built runner the server's own Bybit read is a synthetic stand-in that carries BTC and ETH only, so HYPE could never be priced from it. The body is the Bybit tickers shape the app reads (symbol, lastPrice, price24hPcnt, mark/index price, OI value). */
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, async (route) => { const t = (symbol: string, last: string, pct: string) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' }); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [t('BTCUSDT', '69000', '0.01'), t('ETHUSDT', '3500', '0.012'), t('HYPEUSDT', '42.5', '0.021')] } }) }); });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(16_000); await openList(page);
      const rows = await read(page);
      const dashPrices = Object.entries(rows).filter(([, v]) => v.price === '-').map(([k]) => k);
      const noSignals = Object.values(rows).filter(v => /no signals/i.test(v.status)).length; const nas = Object.values(rows).filter(v => /^n\/a$/i.test(v.status)).length;
      console.log('[K1] ' + JSON.stringify(Object.fromEntries(PRICED.map(c => [c, rows[c] ? `${rows[c].price} | ${rows[c].h24} | ${rows[c].vsbtc}` : '(no row)']))));
      console.log('[K2] ' + JSON.stringify(Object.fromEntries(UNAVAILABLE.map(c => [c, rows[c] ? `${rows[c].price} | ${rows[c].h24} | note=${rows[c].title.slice(0, 80)}` : '(no row)']))));
      console.log(`[K1/K2] rows=${Object.keys(rows).length} bare "-" price cells=${dashPrices.length} (${dashPrices.slice(0, 12).join(',')}) backup asked for: ${JSON.stringify(log.backup)} binance proxy reads: ${log.bn.length}`);
      console.log(`[K4] status "No signals"=${noSignals} status "n/a"=${nas}`);
      expect(Object.keys(rows).length, 'the list did not render').toBeGreaterThan(100);
      for (const c of PRICED) { expect(rows[c], c + ' has no row').toBeTruthy(); expect(isValue(rows[c].price), `${c} price cell reads "${rows[c].price}"`).toBe(true); expect(isValue(rows[c].h24.replace('%', '').replace('+', '')), `${c} 24H cell reads "${rows[c].h24}"`).toBe(true); }
      for (const c of UNAVAILABLE) { expect(rows[c], c + ' has no row').toBeTruthy(); expect(rows[c].price, `${c} price cell`).toMatch(/unavailable/i); expect(rows[c].title.replace(/\|/g, '').length, `${c} has no hover/screen-reader note`).toBeGreaterThan(5); }
      expect(dashPrices, 'a price cell is a bare dash').toEqual([]);
      expect(nas, 'STATUS still says n/a').toBe(0); expect(noSignals, 'STATUS does not say No signals').toBeGreaterThan(300);
      await page.screenshot({ path: 'qa/.shots/k-scanner-binance-refused.png' });
    } finally { await ctx.close(); }
  });

  test('K3a. while the reads are in flight an unpriced row shows the ellipsis, never "Unavailable" (reads held 6 s)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route(/\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index|bybit-tickers)/, async (route) => { await new Promise(r => setTimeout(r, 6_000)); await route.continue(); });
    await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
    const page = await ctx.newPage();
    try {
      await page.goto('/arena', { waitUntil: 'domcontentloaded' }); await openList(page); await page.waitForTimeout(800);
      const rows = await read(page); const unpriced = Object.entries(rows).filter(([, v]) => !isValue(v.price));
      const texts = Array.from(new Set(unpriced.map(([, v]) => v.price)));
      console.log(`[K3a] at ~1-2 s with the reads held: ${Object.keys(rows).length} rows, ${unpriced.length} unpriced, price texts of unpriced rows: ${JSON.stringify(texts)}`);
      expect(unpriced.length, 'every row was priced already: the reads were not held, so the in-flight state was not seen').toBeGreaterThan(0);
      expect(texts.filter(t => /unavailable|^-$/i.test(t)), 'an in-flight row shows Unavailable or a dash').toEqual([]);
      expect(texts.some(t => /…/.test(t)), 'no ellipsis anywhere while the reads were in flight').toBe(true);
    } finally { await ctx.close(); }
  });

  test('K3b. when every read fails the ellipsis does not persist past the capped retry (at most two retries, 30 s and 60 s)', async ({ browser }) => {
    const log = { bn: [] as number[], backup: [] as string[] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await refuseBinance(ctx, log);
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, async (route) => { log.bn.push(Date.now()); await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }); });
    await ctx.route(/\/api\/market\/price-backup/, async (route) => { await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }); });
    const page = await ctx.newPage();
    try {
      const t0 = Date.now(); await gotoGuarded(page, '/arena'); await openList(page);
      await page.waitForTimeout(80_000);
      const rows = await read(page); const texts: Record<string, number> = {}; for (const v of Object.values(rows)) texts[v.price.slice(0, 12)] = (texts[v.price.slice(0, 12)] ?? 0) + 1;
      const times = log.bn.map(t => Math.round((t - t0) / 1000));
      console.log(`[K3b] price texts at 80 s: ${JSON.stringify(Object.fromEntries(Object.entries(texts).sort((a, b) => b[1] - a[1]).slice(0, 6)))}; failing read timestamps (s): ${JSON.stringify(times)}`);
      expect(Object.values(rows).filter(v => /…/.test(v.price)).length, 'the in-flight ellipsis persisted past the capped retry').toBe(0);
      expect(Object.values(rows).filter(v => /unavailable/i.test(v.price)).length, 'no row says Unavailable after every read failed').toBeGreaterThan(0);
      const retries = times.filter(s => s > 20);
      expect(retries.length, 'more retries than the two (30 s and 60 s) after the first read: ' + JSON.stringify(times)).toBeLessThanOrEqual(6);   // each retry round makes up to three reads (universe, binance-only, premium)
    } finally { await ctx.close(); }
  });

  test('K5. the backup is asked only for coins that still lack a price (HYPE, seeded from Bybit, is not asked for)', async ({ browser }) => {
    const log = { bn: [] as number[], backup: [] as string[] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await refuseBinance(ctx, log);
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena'); await page.waitForTimeout(18_000);
      const asked = Array.from(new Set(log.backup.flatMap(s => s.split(',').filter(Boolean))));
      console.log(`[K5] price-backup was asked for: ${JSON.stringify(asked)} (requests ${log.backup.length})`);
      expect(log.backup.length, 'the backup was never asked: nothing was measured').toBeGreaterThan(0);
      expect(asked.includes('hype'), 'the backup was asked for HYPE although Bybit seeds it').toBe(false);
      for (const c of asked) expect(PRICED.concat(['fet']).includes(c), c + ' is not one of the proven backup coins').toBe(true);
    } finally { await ctx.close(); }
  });
});
