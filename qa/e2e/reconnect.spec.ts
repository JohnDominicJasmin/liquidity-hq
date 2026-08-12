import { test, expect, type Page, type BrowserContext } from '@playwright/test';
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

const WINDOW = 70_000;      // longer than the arena's 60s funding interval
const OFFLINE = 20_000;

/** Endpoint identity: path plus `type`, since /api/proxy is many upstreams. */
function endpointOf(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const type = /[?&]type=([a-z0-9-]+)/.exec(url);
  return type ? `${path}?type=${type[1]}` : path;
}

async function measure(page: Page, ms: number) {
  const seen = new Set<string>();
  let count = 0;
  const onReq = (r: { url(): string }) => {
    const u = r.url();
    if (!/\/api\//.test(u)) return;
    count++; seen.add(endpointOf(u));
  };
  page.on('request', onReq);
  await page.waitForTimeout(ms);
  page.off('request', onReq);
  return { count, seen };
}

test.describe('network reconnection', () => {
  test('the endpoints that polled before a disconnect poll again after it', async ({ browser }) => {
    /* Long by necessity: two 70s windows plus a 20s outage plus load. The
       windows must exceed the slowest poller's interval or a healthy endpoint
       reads as dead. */
    test.setTimeout(300_000);

    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();

    try {
      await gotoGuarded(page, '/arena');
      await page.waitForTimeout(8000);

      const online = await measure(page, WINDOW);

      /* CONTROL. Without this the assertion below is satisfied by a page that
         never polls at all - the empty-result trap, and the reason my first
         version of the econ-staleness spec produced four meaningless results. */
      expect(online.count,
        `no api requests at all in ${WINDOW / 1000}s while ONLINE - the page does not poll here, ` +
        `so nothing below would be measuring reconnection`).toBeGreaterThan(10);

      await ctx.setOffline(true);
      await page.waitForTimeout(OFFLINE);
      await ctx.setOffline(false);

      const after = await measure(page, WINDOW);
      const dead = [...online.seen].filter(e => !after.seen.has(e));

      // eslint-disable-next-line no-console
      console.log(`[reconnect] online ${online.count} req / ${online.seen.size} endpoints`
        + ` -> after ${after.count} req / ${after.seen.size} endpoints`
        + (dead.length ? `\n  did not resume: ${dead.join(', ')}` : '\n  all resumed'));

      expect(dead,
        `these endpoints polled before the disconnect and never came back. Before #309 the set was ` +
        `/api/market/klines, /api/macro and /api/cmc?type=global - the chart being the one the owner ` +
        `reported. A shorter list is progress; a non-empty one is still the bug.`).toEqual([]);
    } finally { await ctx.close(); }
  });

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
