/* #2245 (#1263): the Arena scanner's price / 24H / vs BTC / STATUS cells. PM's five cells, as GitHub-run cells, with Binance REFUSED on purpose (the dev/staging condition: the
 * Binance proxy reads answer 429 and every Binance socket closes), so the result does not depend on which addresses the runner is allowed to reach.
 *
 *   K1  FET, COPPER, NATGAS, XPD, XPT, OURA, STRC and HYPE show a price (and a 24H) from the backup / the Bybit seed, never "-", "Unavailable" or the in-flight ellipsis
 *   K2  ANTHROPIC, OPENAI, MOONSHOT, DIS, FRHC, PAYP and HK0625/0700/0992/1810 show the ellipsis while the retries run and read "Unavailable" with a note only AFTER them (about 90 s with Binance refused), and NO price cell anywhere in the list is a bare "-"
 *   K3  while the reads are in flight an unpriced row shows the ellipsis, never "Unavailable"; when every read fails the ellipsis persists through the two capped retries (30 s, 60 s) and the word shows only after them (RE-PINNED 2026-11-20 for #2732, PM option A "retries first, the word only after them")
 *   K4  STATUS reads "No signals" instead of "n/a"
 *   K5  the backup is asked only for coins that still lack a price (HYPE, which Bybit seeds, is not asked for). NOT SHOWN: the Binance-healthy case itself (a runner cannot be made a
 *       Binance-allowed address); that stays a check on production after release.
 * Signed out, nothing written or billed. The Hyperliquid backup is the app's own server route calling a real public API. */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
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

  /* RE-PINNED 2026-11-20 for #2732: K2 used to expect "Unavailable" on the ten unproven rows at ~16 s with Binance refused. Those rows are on the Binance-only feed, which now stays PENDING (the loading ellipsis) until the two capped retries (30 s, 60 s) have run, so "Unavailable" is expected only after them, about 90 s in. K1 (priced rows) and K4 (STATUS) are unchanged and still checked at ~16 s; the "no bare dash" check runs at both looks. */
  test('K1+K2+K4. backed rows show a price; unproven rows show the ellipsis while the retries run and say Unavailable only after them; no bare dash; STATUS says No signals', async ({ browser }) => {
    test.setTimeout(260_000);
    const log = { bn: [] as number[], backup: [] as string[] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await refuseBinance(ctx, log);
    /* THE BYBIT BULK READ IS STUBBED so HYPE's seed can be seen: in a locally built runner the server's own Bybit read is a synthetic stand-in that carries BTC and ETH only, so HYPE could never be priced from it. The body is the Bybit tickers shape the app reads (symbol, lastPrice, price24hPcnt, mark/index price, OI value). */
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, async (route) => { const t = (symbol: string, last: string, pct: string) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' }); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [t('BTCUSDT', '69000', '0.01'), t('ETHUSDT', '3500', '0.012'), t('HYPEUSDT', '42.5', '0.021')] } }) }); });
    const page = await ctx.newPage();
    try {
      const t0 = Date.now(); await gotoGuarded(page, '/arena'); await page.waitForTimeout(16_000); await openList(page);
      const rows = await read(page);
      const dashPrices = Object.entries(rows).filter(([, v]) => v.price === '-').map(([k]) => k);
      const noSignals = Object.values(rows).filter(v => /no signals/i.test(v.status)).length; const nas = Object.values(rows).filter(v => /^n\/a$/i.test(v.status)).length;
      console.log('[K1] ' + JSON.stringify(Object.fromEntries(PRICED.map(c => [c, rows[c] ? `${rows[c].price} | ${rows[c].h24} | ${rows[c].vsbtc}` : '(no row)']))));
      console.log('[K2] ' + JSON.stringify(Object.fromEntries(UNAVAILABLE.map(c => [c, rows[c] ? `${rows[c].price} | ${rows[c].h24} | note=${rows[c].title.slice(0, 80)}` : '(no row)']))));
      console.log(`[K1/K2] rows=${Object.keys(rows).length} bare "-" price cells=${dashPrices.length} (${dashPrices.slice(0, 12).join(',')}) backup asked for: ${JSON.stringify(log.backup)} binance proxy reads: ${log.bn.length}`);
      console.log(`[K4] status "No signals"=${noSignals} status "n/a"=${nas}`);
      expect(Object.keys(rows).length, 'the list did not render').toBeGreaterThan(100);
      for (const c of PRICED) { expect(rows[c], c + ' has no row').toBeTruthy(); expect(isValue(rows[c].price), `${c} price cell reads "${rows[c].price}"`).toBe(true); expect(isValue(rows[c].h24.replace('%', '').replace('+', '')), `${c} 24H cell reads "${rows[c].h24}"`).toBe(true); }
      /* AT ~16 S (retries not used yet): the loading ellipsis, never the word and never a dash */
      for (const c of UNAVAILABLE) { expect(rows[c], c + ' has no row').toBeTruthy(); expect(rows[c].price, `${c} price cell at ~16 s: the ellipsis while the retries run`).toMatch(/…/); expect(rows[c].price, `${c} says Unavailable before the retries are used`).not.toMatch(/unavailable/i); }
      expect(dashPrices, 'a price cell is a bare dash').toEqual([]);
      expect(nas, 'STATUS still says n/a').toBe(0); expect(noSignals, 'STATUS does not say No signals').toBeGreaterThan(300);
      /* STILL BEFORE THE THIRD PASS (~65 s: the 30 s retry has run, the 60 s one has not): still the ellipsis */
      await page.waitForTimeout(Math.max(0, 65_000 - (Date.now() - t0)));
      const mid = await read(page); const midBad = UNAVAILABLE.filter(c => !/…/.test(mid[c]?.price ?? '') || /unavailable/i.test(mid[c]?.price ?? ''));
      console.log(`[K2] at ~65 s rows not showing the ellipsis: ${JSON.stringify(midBad)}`);
      expect(midBad, 'an unproven row stopped showing the ellipsis before the retries (30 s and 60 s) were used').toEqual([]);
      /* AFTER THE RETRIES (third pass at ~90 s): the word, with its note, and still no bare dash anywhere */
      await expect.poll(async () => { const r = await read(page); return UNAVAILABLE.filter(c => !/unavailable/i.test(r[c]?.price ?? '')); }, { timeout: 110_000, intervals: [5_000], message: 'the unproven rows never said Unavailable after the retries were used (about 90 s)' }).toEqual([]);
      const late = await read(page); console.log('[K2] after the retries ' + JSON.stringify(Object.fromEntries(UNAVAILABLE.map(c => [c, late[c] ? `${late[c].price} | note=${late[c].title.slice(0, 80)}` : '(no row)']))));
      for (const c of UNAVAILABLE) { expect(late[c].price, `${c} price cell after the retries`).toMatch(/unavailable/i); expect(late[c].title.replace(/\|/g, '').length, `${c} has no hover/screen-reader note`).toBeGreaterThan(5); }
      expect(Object.entries(late).filter(([, v]) => v.price === '-').map(([k]) => k), 'a price cell is a bare dash after the retries').toEqual([]);
      for (const c of PRICED) expect(isValue(late[c].price), `${c} lost its price after the retries: "${late[c].price}"`).toBe(true);
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

  /* RE-PINNED 2026-11-20 for #2732 (PM option A, "retries first, the word only after them"): K3b used to say that after 80 s the ellipsis was gone and "Unavailable" was showing. The scanner feed is now set to failed only on the THIRD failed pass, after the two capped retries (30 s, then 60 s), so the ellipsis persists up to about 90 s and "Unavailable" shows after it. The look at ~10 s and the look at ~75 s now expect the ellipsis and NO word; the word is awaited (up to ~165 s) and the old end-state assertions (no ellipsis left, the word on the unpriced rows) run once it shows. The "at most two retries" bound is kept as it was, at its original ~80 s look; a lower bound is added: at least one retry round ran before the word appeared. */
  test('K3b. when every read fails the ellipsis persists through the capped retries (30 s and 60 s) and "Unavailable" shows only after them, about 90 s in', async ({ browser }) => {
    test.setTimeout(260_000);
    const log = { bn: [] as number[], backup: [] as string[] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await refuseBinance(ctx, log);
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, async (route) => { log.bn.push(Date.now()); await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }); });
    await ctx.route(/\/api\/market\/price-backup/, async (route) => { await route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }); });
    const page = await ctx.newPage();
    const tally = (rows: Awaited<ReturnType<typeof read>>) => { const texts: Record<string, number> = {}; for (const v of Object.values(rows)) texts[v.price.slice(0, 12)] = (texts[v.price.slice(0, 12)] ?? 0) + 1; return { ellipsis: Object.values(rows).filter(v => /…/.test(v.price)).length, word: Object.values(rows).filter(v => /unavailable/i.test(v.price)).length, top: JSON.stringify(Object.fromEntries(Object.entries(texts).sort((a, b) => b[1] - a[1]).slice(0, 6))) }; };
    try {
      const t0 = Date.now(); await gotoGuarded(page, '/arena'); await openList(page);
      await page.waitForTimeout(10_000);
      const early = tally(await read(page)); console.log(`[K3b] at ~10 s: ellipsis=${early.ellipsis} word=${early.word} ${early.top}`);
      expect(early.ellipsis, 'no ellipsis at ~10 s: the first failed read must keep the loading ellipsis').toBeGreaterThan(0);
      expect(early.word, 'a row says Unavailable at ~10 s, before the retries were used').toBe(0);
      await page.waitForTimeout(Math.max(0, 75_000 - (Date.now() - t0)));
      const rows = await read(page); const mid = tally(rows);
      const times = log.bn.map(t => Math.round((t - t0) / 1000));
      console.log(`[K3b] at ~75 s: ellipsis=${mid.ellipsis} word=${mid.word} ${mid.top}; failing read timestamps (s): ${JSON.stringify(times)}`);
      expect(mid.ellipsis, 'the ellipsis was gone at ~75 s, before the second retry (60 s after the first) had run').toBeGreaterThan(0);
      expect(mid.word, 'a row says Unavailable at ~75 s, before the retries were used').toBe(0);
      const retries = times.filter(s => s > 20);
      expect(retries.length, 'more retries than the two (30 s and 60 s) after the first read: ' + JSON.stringify(times)).toBeLessThanOrEqual(6);   // each retry round makes up to three reads (universe, binance-only, premium)
      await expect.poll(async () => tally(await read(page)).word, { timeout: 90_000, intervals: [5_000], message: 'no row ever said Unavailable after every read failed and the retries were used (about 90 s)' }).toBeGreaterThan(0);
      const late = tally(await read(page)); const lateTimes = log.bn.map(t => Math.round((t - t0) / 1000));
      console.log(`[K3b] when the word showed: ellipsis=${late.ellipsis} word=${late.word} ${late.top}; failing read timestamps (s): ${JSON.stringify(lateTimes)}`);
      expect(late.ellipsis, 'the in-flight ellipsis is still showing next to the word after the retries were used').toBe(0);
      expect(late.word, 'no row says Unavailable after every read failed').toBeGreaterThan(0);
      expect(lateTimes.filter(s => s > 20).length, 'the word showed with no retry round having run: it must come after the retries').toBeGreaterThanOrEqual(2);
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

/* K6 (Dev, #2245): the landing page's price ticker gets the same honest states. With Binance refused and the Bybit bulk answer stubbed (BTC, ETH, SOL, XRP, BNB), SOL, XRP and BNB
 * show a value (a price at desktop width, the 24H change at phone width where the ticker omits the price), never a bare dash; and the whole ticker has no bare dash at all.
 * The same page is shot at 390/768/1280 in light and dark for PM's landing sign-off. */
const bybitBody = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015'], ['XRPUSDT', '0.62', '0.02'], ['BNBUSDT', '610.2', '0.005']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280]) {
  test(`K6. landing ticker with Binance refused at ${width}px ${theme}: SOL, XRP and BNB show a value, no bare dash anywhere`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await refuseBinance(ctx);
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private */ } }, theme);
    await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: bybitBody }); });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/');
      /* RE-PINNED (#2555, QA 2026-11-18): the ticker now HIDES a coin with no price, so with only these 5 coins stubbed it has exactly 5 cells (it used to pad with dash cells); and a fixed 16 s wait lost a race on a slow runner (one attempt read every cell as "..."). Poll until the three coins carry a digit (max 45 s) instead. */
      const readTicker = () => page.evaluate(() => { const cells = Array.from(document.querySelectorAll('.lpt-ticker > div')) as HTMLElement[]; const all = cells.map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()); const pick = (l: string) => all.find((t) => t.split(' ').includes(l)) ?? ''; return { n: all.length, ok: ['SOL', 'XRP', 'BNB'].every((k) => /\d/.test(pick(k))) }; });
      await expect.poll(async () => { const r = await readTicker(); return r.n >= 5 && r.ok; }, { timeout: 45_000, message: 'SOL, XRP and BNB never carried a value in the ticker' }).toBe(true);
      const m = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('.lpt-ticker > div')) as HTMLElement[];
        const txt = (c: HTMLElement) => (c.innerText || '').replace(/\s+/g, ' ').trim();
        const all = cells.map(txt);
        const pick = (l: string) => all.find(t => t.split(' ').includes(l)) ?? null;
        return { sample: all.slice(0, 6), cells: all.length, sol: pick('SOL'), xrp: pick('XRP'), bnb: pick('BNB'), btc: pick('BTC'), bareDash: all.filter(t => /(^|\s)-(\s|$)/.test(t)).slice(0, 12), words: Array.from(new Set(all.flatMap(t => t.split(' ').filter(w => /^(n\/a|…|\.\.\.)$/.test(w))))) };
      });
      console.log(`[K6] ${width} ${theme} ${JSON.stringify(m)}`);
      mkdirSync('qa/.shots', { recursive: true });
      await page.screenshot({ path: `qa/.shots/k6-landing-${width}-${theme}.png` });
      expect(m.cells, 'the ticker did not render (the 5 stubbed coins, BTC ETH SOL XRP BNB, must each have a cell)').toBeGreaterThanOrEqual(5);
      for (const [k, v] of [['SOL', m.sol], ['XRP', m.xrp], ['BNB', m.bnb]] as const) expect(v && /\d/.test(v), `${k} shows no value in the ticker: "${v}"`).toBeTruthy();
      expect(m.bareDash, 'a ticker cell holds a bare dash').toEqual([]);
    } finally { await ctx.close(); }
  });
}
