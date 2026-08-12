import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Does the app resume after a network drop? (#306, dev's fix in #309)
 *
 * THE PRE-FIX STATE IS MEASURED, not assumed. Against deployed `qa` @ `ae213e7`,
 * `/arena`, 70-second windows either side of a 20-second disconnect:
 *
 *     online            63 api requests across 8 endpoints
 *     after reconnect   13 api requests across 6 endpoints
 *
 *     did not come back:  /api/market/klines   /api/macro   /api/cmc?type=global
 *     still polling:      proxy?type=depth, proxy?type=premium-index,
 *                         coinbase-price, config, proxy?type=oi-hist, funding
 *
 * Run twice: 62/13 and 63/13. Dev could not get a valid before-control on their
 * side - their pre-fix run never opened a kline socket at all, so "still dead"
 * proved nothing and they said so rather than presenting it. This is that
 * control, taken before the fix existed.
 *
 * WHY THE CONTROL IS THE WHOLE TEST. "No requests after reconnect" is satisfied
 * perfectly by a page that never made any. So the online window runs first and
 * the spec refuses to continue if it comes back empty - otherwise a route that
 * simply does not poll reads as the defect.
 */

test.describe('network reconnection', () => {
  /* THE REST TEST THAT USED TO LIVE HERE WAS REMOVED, and the reason matters
   * more than the test did.
   *
   * It asserted that every endpoint polling before a disconnect polls again
   * after it, and reported three that did not:
   *
   *     /api/cmc?type=global   MarketProvider.tsx:1326   every 5 minutes
   *     /api/macro             MarketProvider.tsx:1328   every 10 minutes
   *     /api/market/klines     KLineProChart              history fetch, no timer
   *
   * The measurement window is 70 SECONDS. None of the three would fire inside
   * it whether the network dropped or not. They appeared in the "online" set
   * only because a window opened at page load catches the MOUNT-TIME fetch,
   * which is a one-off rather than the interval.
   *
   * So the assertion compared a mount-time fetch against a steady-state window
   * and called the difference a defect. The same red would appear on a machine
   * that never went offline. Dev caught it; it is the mirror of the USD/JPY
   * problem on econ-staleness.spec.ts - an uncontrolled variable producing a
   * difference that looks like the effect under test.
   *
   * A sound version would need a window longer than the slowest interval (10
   * minutes each side), which is not worth the runtime for what it proves. The
   * socket test below covers the thing the owner actually reported.
   *
   * WHAT REMAINS GENUINELY UNCOVERED: the socket resumes and appends new
   * candles, but bars that elapsed DURING the outage are never backfetched, so
   * the chart can carry a gap until the next symbol or timeframe change.
   * Narrower than "three endpoints did not resume", and real. Tracked on #306.
   */

  test('CONTROL: a live candle socket exists and is replaced after a drop', async ({ browser }) => {
    /* Dev's fix is specifically the Binance kline WebSocket, which the REST
       measurement above cannot see. This asserts the socket layer directly, and
       asserts a socket EXISTS first - the failure that voided dev's own
       before-control was a run where none was ever opened, which would make
       "no new socket" trivially true. */
    test.setTimeout(240_000);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
      const w = window as unknown as { __ws: string[] };
      w.__ws = [];
      const Native = WebSocket;
      // @ts-expect-error - deliberate instrumentation
      window.WebSocket = function (url: string, protocols?: string | string[]) {
        w.__ws.push(String(url));
        return new Native(url, protocols as string | string[] | undefined);
      };
      window.WebSocket.prototype = Native.prototype;
    });
    const page = await ctx.newPage();

    const klineSockets = () => page.evaluate(() =>
      ((window as unknown as { __ws: string[] }).__ws || []).filter(u => /kline|stream/i.test(u)).length);

    try {
      await gotoGuarded(page, '/arena');
      await page.waitForTimeout(20_000);

      const before = await klineSockets();
      test.skip(before === 0,
        'no live candle socket was opened in this run - subscribeBar only fires after the history ' +
        'fetch succeeds, so an unreachable upstream makes this test vacuous rather than failing. ' +
        'This is the exact run shape that voided dev\'s before-control on #309.');

      await ctx.setOffline(true);
      await page.waitForTimeout(15_000);
      await ctx.setOffline(false);
      await page.waitForTimeout(30_000);

      const afterCount = await klineSockets();
      // eslint-disable-next-line no-console
      console.log(`[socket] kline sockets opened: ${before} -> ${afterCount}`);

      expect(afterCount,
        'no NEW candle socket was opened after the network returned. Before #309 the socket was ' +
        'created once and an unclean close only set the status dot to "connecting" - the chart ' +
        'stayed frozen at its last bar until a reload.').toBeGreaterThan(before);
    } finally { await ctx.close(); }
  });
});
