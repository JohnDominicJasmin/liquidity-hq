/* Self-test for rlib's market-data guard (#1688). Proves the guard both ways, because a check that cannot fail is worth nothing.
 *
 * It needs NO deployed site and NO account: one about:blank page per case, and `fetch` called from the page at the exchange host, which
 * rlib's fence lets through on purpose. One short headless Chromium through memguard.
 *
 * CASE 1, positive: the exchange answers -> reached, and assertMarketDataReached returns.
 * CASE 2, negative: the exchange is blocked, the way a geo-blocked cloud container blocks it -> assertMarketDataReached THROWS, and the
 *         message names the host and says not to report the run.
 * CASE 3: a run that never asked for market data is not punished for it.
 *
 * CASE 1 CANNOT PASS IN A CLOUD CONTAINER, by construction: Bybit and Binance are geo-blocked there, which is the very thing case 2
 * simulates. So this file is the one QA run that has to happen on a machine with exchange access, and it is seconds long.
 * usage: node selftest-marketguard.mjs */
import { chromium, open, assertMarketDataReached, marketDataOutcome } from './rlib.mjs';

const EXCHANGE = 'https://api.bybit.com/v5/market/time';
const ask = (page, url) => page.evaluate(async (u) => {
  try { const r = await fetch(u, { cache: 'no-store' }); return r.status; } catch (e) { return `threw: ${String(e).slice(0, 60)}`; }
}, url);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`); if (!ok) failures++; };

const browser = await chromium.launch();
try {
  /* ── 1. the exchange answers ── */
  {
    const ctx = await open(browser, { acct: 'anon' });
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const status = await ask(page, EXCHANGE);
    const out = marketDataOutcome(ctx);
    check('1a. the exchange host answered and was recorded', out.reached === true, `status ${status}, ok=[${out.ok}]`);
    let threw = null;
    try { assertMarketDataReached(ctx, 'case 1'); } catch (e) { threw = e; }
    check('1b. assertMarketDataReached lets a run with real market data report', threw === null, threw ? threw.message.slice(0, 80) : '');
    await ctx.close();
  }

  /* ── 2. the exchange is blocked, as in a geo-blocked container ── */
  {
    const ctx = await open(browser, { acct: 'anon' });
    // Registered AFTER open(), so it wins: Playwright uses the most recently added matching route.
    await ctx.route(/api\.(bybit|binance)\.com/, (r) => r.abort('blockedbyclient'));
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const status = await ask(page, EXCHANGE);
    const out = marketDataOutcome(ctx);
    check('2a. a blocked exchange is recorded as asked-but-not-reached', out.asked.length > 0 && out.reached === false,
      `page saw "${status}", asked=[${out.asked}], failed=${JSON.stringify(out.failed)}`);
    let threw = null;
    try { assertMarketDataReached(ctx, 'case 2'); } catch (e) { threw = e; }
    check('2b. assertMarketDataReached REFUSES to let the run report', threw !== null);
    check('2c. the refusal names the host and says not to report', !!threw && /NOT REPORTING/.test(threw.message) && /bybit/.test(threw.message),
      threw ? threw.message.slice(0, 120) : 'no error thrown');
    await ctx.close();
  }

  /* ── 3. a run that needed no market data ── */
  {
    const ctx = await open(browser, { acct: 'anon' });
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const out = marketDataOutcome(ctx);
    let threw = null;
    try { assertMarketDataReached(ctx, 'case 3'); } catch (e) { threw = e; }
    check('3. a run that asked for no market data is allowed to report', threw === null && out.asked.length === 0,
      threw ? threw.message.slice(0, 80) : `asked=[${out.asked}]`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? 'ALL CASES AS EXPECTED' : `${failures} CASE(S) WRONG`);
process.exit(failures === 0 ? 0 : 1);
