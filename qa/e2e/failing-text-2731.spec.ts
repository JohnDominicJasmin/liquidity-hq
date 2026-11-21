import { test, expect, type Page, type Browser } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { servedLabels } from './_shared';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* PR #2731 (failing-text sweep 2), deployed gated site (qa), signed in as Pro fixture A. A failed REFRESH keeps the last good value and shows no failure line; only a first load with nothing on screen shows one.
 *
 *   C1  /arena?coin=btc&tf=1h loads candles, then every kline request starts failing and the chart reloads its history (the same chart.resetData() the chart's own retry and tab-resume call): the candle count comes back (the last good candles are kept) and the "Couldn't load price history" line is absent
 *   C2  CONTROL: the klines fail from the very first load, so there is nothing to keep: the line IS shown and the chart holds no candles
 *   J1  /journal loads the account's trades, a save is made (its WRITE is answered by a stand-in and never reaches the database), the re-read that follows fails: the trades stay, the History count is unchanged and the "Couldn't load your trades" card is absent (History and Stats tabs)
 *   J2  CONTROL: the first trades read fails with nothing on screen: the card IS shown with its retry button, and the retry (reads work again) clears it
 *
 * THE EXPECTED TEXT COMES FROM THE SERVED LABEL MAP (CHART_HISTORY_FAILED, TRADE_JOURNAL_HISTORY_LOAD_FAILED / _RETRY, TRADE_JOURNAL_TAB_HISTORY), not from the page under test and not typed here.
 *
 * NOTHING IS WRITTEN TO THE SHARED DATABASE. Every non-read request to a *trades* table is answered by the stand-in and never forwarded (a request that would have been forwarded cannot exist: the handler has no pass-through for a write), and the
 * spec asserts the stand-in saw the one POST it expects, so a changed table name fails the run instead of writing. The kline requests are stubbed with synthetic candles in both directions, like arena-stale-result-labelling.spec.ts, so the real exchange is not a variable.
 *
 * HOW THE FAILED REFRESH IS TRIGGERED, and why it is not "switch timeframe and back": the chart keeps ONE last-good set keyed by coin AND timeframe, so a timeframe switch has nothing to keep for the timeframe it lands on, and the line is correct there. The refresh that has a
 * last good is a reload of the SAME coin and timeframe: the chart's own retry and its tab-resume both call chart.resetData(), and the spec calls it on the klinecharts instance found through React's fiber (as prod-release-1122.spec.ts D2 does).
 *
 * NOT RUN WHEN WRITTEN: the machine is under a memory limit, no browser was started. Syntax-checked only. Expected on the PR head: all four green. Expected on dev (before the PR): C1 and J1 RED (the line / the card shows over kept data), C2 and J2 green. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const BARS = 300;
const HOUR_MS = 3_600_000;
const candleRows = (): Array<[number, number, number, number, number, number]> => {
  const base = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  return Array.from({ length: BARS }, (_, i) => {
    const p = 100 + (i % 10);
    return [base - (BARS - 1 - i) * HOUR_MS, p, p + 1, p - 1, p + 0.5, 10];
  });
};

interface KlineWorld { mode: 'ok' | 'fail'; failed: number }

/** Every /api/market/klines call: synthetic candles in the shape of the requested source, or a 502 (what the route answers when upstream refuses). */
async function stubKlines(page: Page, world: KlineWorld) {
  await page.route('**/api/market/klines**', async route => {
    if (world.mode === 'fail') {
      world.failed++;
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'qa stand-in: upstream refused' }) });
    }
    const source = new URL(route.request().url()).searchParams.get('source') ?? '';
    const rows = candleRows();
    const body = source === 'bybit'
      ? { retCode: 0, result: { list: [...rows].reverse().map(r => r.map(String)) } }   // Bybit: newest first, strings, inside its envelope
      : rows;                                                                          // Binance: oldest first, a bare array
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** The klinecharts instance through React's fiber (prod-release-1122.spec.ts D2; the S/R button walk of qa/tools/qa-howto-arena/label-states.mjs is the fallback). Parks it on window so the reload can be called. */
async function chartInfo(page: Page): Promise<{ n: number; first: number | null; last: number | null } | null> {
  return page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const find = (start: any): any => {
      const key = start && Object.keys(start).find(k => k.startsWith('__reactFiber$'));
      let f: any = key ? start[key] : null;
      while (f) {
        let s = f.memoizedState; let n = 0;
        while (s && n < 300) { const q = s.memoizedState; if (q && typeof q === 'object' && q.current && typeof q.current.getDataList === 'function') return q.current; s = s.next; n++; }
        f = f.return;
      }
      return null;
    };
    let chart = find(document.querySelector('.klc-canvas'));
    if (!chart) { const sr = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'S/R' && !b.closest('.strat-panel')); chart = find(sr); }
    if (!chart) return null;
    w.__qaChart = chart;
    const l = chart.getDataList() as Array<{ timestamp: number }>;
    return { n: l.length, first: l.length ? l[0].timestamp : null, last: l.length ? l[l.length - 1].timestamp : null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
}

async function openArena(browser: Browser, world: KlineWorld) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ } });
  const page = await ctx.newPage();
  await installPaidAiFence(page);   // before any stub of this spec
  await stubKlines(page, world);
  return { ctx, page };
}

test.describe('Chart: a failed refresh keeps the candles and shows no failure line; a failed first load shows it (#2731)', () => {
  test('C1. candles loaded, then the klines fail and the history reloads: the candles stay, no "Couldn\'t load price history" line', async ({ browser }) => {
    test.setTimeout(240_000);
    const world: KlineWorld = { mode: 'ok', failed: 0 };
    const { ctx, page } = await openArena(browser, world);
    try {
      const labels = await servedLabels(page.request);
      const prefix = (labels.CHART_HISTORY_FAILED ?? '').split('{')[0].trim();
      expect(prefix, 'CHART_HISTORY_FAILED is in neither the served labels nor the shipped defaults, so the line cannot be identified by key').toBeTruthy();
      const line = page.getByText(prefix);

      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await expect.poll(async () => (await chartInfo(page))?.n ?? 0, { message: 'the chart never loaded candles from the stubbed klines - this run measured nothing', timeout: 90_000 }).toBeGreaterThan(100);
      const before = (await chartInfo(page))!;
      await expect(line, 'CONTROL: the failure line is on screen although the load succeeded').toHaveCount(0);

      world.mode = 'fail'; world.failed = 0;
      await page.evaluate(() => { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ (window as any).__qaChart.resetData(); });

      await expect.poll(() => world.failed, { message: 'the reload never asked for klines, so no failed refresh happened', timeout: 30_000 }).toBeGreaterThanOrEqual(3);
      /* THE LOAD IS FINISHED ONLY AFTER ITS LAST SOURCE FAILED: Bybit is tried three times (0.5 s and 1.5 s apart), then Binance spot and futures. Checking the candle count earlier could read the chart before the failed load has answered it, and a broken build would pass. */
      await page.waitForTimeout(8_000);
      await expect.poll(async () => (await chartInfo(page))?.n ?? 0,
        { message: 'a failed refresh emptied the chart: the last good candles were not kept', timeout: 15_000 }).toBeGreaterThanOrEqual(before.n);
      const after = (await chartInfo(page))!;
      expect(after.first, 'the candles the chart shows after the failed refresh are not the ones it had').toBe(before.first);
      await expect(line, 'a failed refresh that kept the candles still showed "Couldn\'t load price history"').toHaveCount(0);
      await page.waitForTimeout(4_000);   // the line is raised in the same tick as the keep, but give a late render time to show itself
      await expect(line, 'the failure line appeared late over the kept candles').toHaveCount(0);
    } finally {
      try { assertNoUnstubbedPaidAi(page, 'C1'); } finally { await ctx.close(); }
    }
  });

  test('C2. CONTROL: the klines fail from the first load, nothing to keep: the failure line IS shown and the chart holds no candles', async ({ browser }) => {
    test.setTimeout(240_000);
    const world: KlineWorld = { mode: 'fail', failed: 0 };
    const { ctx, page } = await openArena(browser, world);
    try {
      const labels = await servedLabels(page.request);
      const prefix = (labels.CHART_HISTORY_FAILED ?? '').split('{')[0].trim();
      expect(prefix).toBeTruthy();
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await expect(page.getByText(prefix).first(), 'a first load that failed with no candles must say so: the "Couldn\'t load price history" line did not appear').toBeVisible({ timeout: 90_000 });
      expect(world.failed, 'the control never reached the failing stub').toBeGreaterThanOrEqual(3);
      expect((await chartInfo(page))?.n ?? 0, 'the chart holds candles although every kline request failed').toBe(0);
    } finally {
      try { assertNoUnstubbedPaidAi(page, 'C2'); } finally { await ctx.close(); }
    }
  });
});

/* ══ the journal ═══════════════════════════════════════════════════════════════════════════════════════════════════════════ */

/** A row the page can render, used only when the account has none (a real read is passed through untouched otherwise). */
const SYNTHETIC_TRADE = {
  id: 'qa-2731-stand-in-trade', created_at: new Date().toISOString(), coin: 'btc', direction: 'LONG', setup_type: 'Other',
  entry_price: 65000, stop_loss: 64000, exit_price: null, take_profit: null, position_size_usd: null, risk_usd: null, leverage: null,
  result: 'OPEN', pnl_usd: null, pnl_r: null, notes: 'qa 2731 stand-in', session: 'London',
};

interface TradesWorld { mode: 'ok' | 'fail'; reads: number; readsFailed: number; writes: string[]; substituted: boolean }

/** ONE handler for every *trades* table. A read is the real read (or fails on demand); a write is answered here and never forwarded. */
async function stubTrades(page: Page, world: TradesWorld) {
  await page.route(/\/rest\/v1\/[^/?]*trades[^/?]*(\?|$)/, async (route, request) => {
    const method = request.method();
    const origin = request.headers()['origin'] ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'Content-Range' };
    if (method !== 'GET' && method !== 'HEAD') {
      world.writes.push(`${method} ${new URL(request.url()).pathname}`);
      return route.fulfill({ status: method === 'POST' ? 201 : 204, headers: cors, body: '' });
    }
    world.reads++;
    if (world.mode === 'fail') { world.readsFailed++; return route.abort('failed'); }
    const res = await route.fetch();
    let rows: unknown = null;
    try { rows = await res.json(); } catch { /* not JSON: pass it through */ }
    if (Array.isArray(rows) && rows.length === 0) {
      world.substituted = true;
      const { 'content-length': _l, 'content-encoding': _e, ...headers } = res.headers();
      return route.fulfill({ response: res, headers, body: JSON.stringify([SYNTHETIC_TRADE]) });
    }
    return route.fulfill({ response: res });
  });
}

const historyCount = async (page: Page): Promise<number | null> => {
  const txt = (await page.locator('[data-testid="journal-tab"]').nth(1).innerText().catch(() => '')) || '';
  const m = /\((\d+)\)/.exec(txt);
  return m ? Number(m[1]) : null;
};

async function openJournal(browser: Browser, world: TradesWorld) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ } });
  const page = await ctx.newPage();
  await installPaidAiFence(page);
  await stubTrades(page, world);
  return { ctx, page };
}

test.describe('Journal: a failed re-read keeps the loaded trades and shows no error card; a failed first read shows it (#2731)', () => {
  test('J1. trades loaded, a save is made (stand-in write), the re-read fails: the trades stay, no "Couldn\'t load your trades" card', async ({ browser }) => {
    test.setTimeout(240_000);
    const world: TradesWorld = { mode: 'ok', reads: 0, readsFailed: 0, writes: [], substituted: false };
    const { ctx, page } = await openJournal(browser, world);
    try {
      const labels = await servedLabels(page.request);
      const failedText = labels.TRADE_JOURNAL_HISTORY_LOAD_FAILED;
      expect(failedText, 'TRADE_JOURNAL_HISTORY_LOAD_FAILED is in neither the served labels nor the shipped defaults').toBeTruthy();
      const card = page.getByText(failedText);

      await gotoSignedIn(page, '/journal');
      await expect.poll(() => historyCount(page), { message: 'the journal never showed a trade count above 0 from the first read (a real read, or the stand-in row when the account has none)', timeout: 60_000 }).toBeGreaterThan(0);
      const n0 = (await historyCount(page))!;
      console.log(`[J1] first read: ${n0} trade(s)${world.substituted ? ' (account had none: one stand-in row was substituted into the READ)' : ' (the account\'s real rows)'}`);

      // log a trade; its write is answered by the stand-in, then every re-read fails
      await page.locator('[data-testid="journal-input"]').nth(0).fill('65000');
      await page.locator('[data-testid="journal-input"]').nth(1).fill('64000');
      world.mode = 'fail'; world.readsFailed = 0;
      const submit = page.locator('.tj-submit');
      await expect(submit).toBeEnabled();
      await submit.click();

      await expect.poll(() => world.writes.length, { message: 'the save never reached the stand-in: the trades table name or the route changed, and nothing was written', timeout: 20_000 }).toBe(1);
      expect(world.writes[0], 'the one write was not the insert the save makes').toMatch(/^POST /);
      await expect.poll(() => world.readsFailed, { message: 'the re-read after the save never ran, so no failed re-read happened', timeout: 60_000 }).toBeGreaterThanOrEqual(3);

      // the save moves to the History tab once its re-read has finished (the page retries a failed read twice first, about 8 s)
      await expect(page.locator('.tj-trade').first(), 'the loaded trades are gone after a failed re-read').toBeVisible({ timeout: 60_000 });
      await expect(card, 'a failed RE-read showed "Couldn\'t load your trades" over trades that are on screen (History tab)').toHaveCount(0);
      expect(await historyCount(page), 'the History count changed after a failed re-read').toBe(n0);

      await page.locator('[data-testid="journal-tab"]').nth(2).click();   // Stats
      await page.waitForTimeout(1_500);
      await expect(card, 'a failed re-read showed "Couldn\'t load your trades" on the Stats tab').toHaveCount(0);
      expect(world.writes, 'something other than the one stubbed insert was written').toHaveLength(1);
    } finally {
      try { assertNoUnstubbedPaidAi(page, 'J1'); } finally { await ctx.close(); }
    }
  });

  test('J2. CONTROL: the first trades read fails with nothing on screen: the card IS shown with its retry, and the retry recovers', async ({ browser }) => {
    test.setTimeout(240_000);
    const world: TradesWorld = { mode: 'fail', reads: 0, readsFailed: 0, writes: [], substituted: false };
    const { ctx, page } = await openJournal(browser, world);
    try {
      const labels = await servedLabels(page.request);
      const failedText = labels.TRADE_JOURNAL_HISTORY_LOAD_FAILED, retryText = labels.TRADE_JOURNAL_HISTORY_LOAD_RETRY;
      expect(failedText && retryText, 'the journal failure labels are in neither the served labels nor the shipped defaults').toBeTruthy();
      await gotoSignedIn(page, '/journal');
      await page.locator('[data-testid="journal-tab"]').nth(1).click();   // History
      const card = page.getByText(failedText);
      await expect(card.first(), 'a first read that failed with no trades must say so: the "Couldn\'t load your trades" card did not appear').toBeVisible({ timeout: 90_000 });
      expect(world.readsFailed, 'the control never reached the failing stub').toBeGreaterThanOrEqual(3);
      const retry = page.getByRole('button', { name: retryText }).first();
      await expect(retry, 'the card has no retry button').toBeVisible();

      world.mode = 'ok';   // reads work again: the retry is a read, nothing is written
      await retry.click();
      await expect(card, 'the retry succeeded but the error card stayed').toHaveCount(0, { timeout: 30_000 });
      expect(world.writes, 'the control wrote something').toHaveLength(0);
    } finally {
      try { assertNoUnstubbedPaidAi(page, 'J2'); } finally { await ctx.close(); }
    }
  });
});
